const Request = require('../models/Request');
const User = require('../models/User');
const mongoose = require('mongoose');
const { getDistance, calculateScore, filterUsersWithinRadius } = require('../utils/matchingAlgorithm');

const EMERGENCY_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

const getCompatibility = (donorBloodGroup, requestedBloodGroup) => {
  if (!donorBloodGroup) return 'Not compatible';
  if (donorBloodGroup === requestedBloodGroup) return 'Exact';
  if (donorBloodGroup === 'O-') return 'Compatible';
  if (requestedBloodGroup === 'AB+') return 'Compatible';
  const base = (bg) => bg.replace('+', '').replace('-', '');
  const isPos = (bg) => bg.includes('+');
  if (base(donorBloodGroup) === base(requestedBloodGroup) && isPos(requestedBloodGroup) && !isPos(donorBloodGroup)) {
    return 'Compatible';
  }
  return 'Not compatible';
};

const checkEligibility = (lastDonationDate) => {
  if (!lastDonationDate) return true;
  const days = Math.floor((new Date() - new Date(lastDonationDate)) / (1000 * 60 * 60 * 24));
  return days >= 90;
};

const createRequest = async (req, res) => {
  try {
    const { bloodGroup, urgency, latitude, longitude } = req.body;
    const requester = await User.findById(req.user._id);
    const lat = parseFloat(latitude) || requester?.location?.coordinates?.[1] || 0;
    const lng = parseFloat(longitude) || requester?.location?.coordinates?.[0] || 0;
    const currentRegion = requester?.currentRegion || req.user.currentRegion || 'south-zone';

    const request = await Request.create({
      requester: req.user._id,
      bloodGroup,
      urgency: urgency || 'Medium',
      currentRegion,
      location: {
        type: 'Point',
        coordinates: [lng, lat],
      },
    });

    const expiresAt = new Date(request.createdAt.getTime() + EMERGENCY_EXPIRY_MS).toISOString();

    const io = req.app.get('io');
    const allUsersInRegion = await User.find({ _id: { $ne: req.user._id }, currentRegion, role: 'User' });
    const nearbyUsers = filterUsersWithinRadius(allUsersInRegion, lat, lng, 5);
    const scoredMatches = [];

    for (const user of nearbyUsers) {
      const distance = getDistance(lat, lng, user.location.coordinates[1], user.location.coordinates[0]);
      const compatibility = getCompatibility(user.bloodGroup, bloodGroup);
      const available = user.isAvailable !== false;
      const eligible = checkEligibility(user.lastDonationDate) && user.is_eligible !== false;
      const shouldNotify = compatibility !== 'Not compatible' && available && eligible;

      if (shouldNotify) {
        const lastDonationDaysAgo = user.lastDonationDate
          ? Math.floor((new Date() - new Date(user.lastDonationDate)) / (1000 * 60 * 60 * 24))
          : null;
        const score = calculateScore(distance, compatibility, user.isAvailable !== false, lastDonationDaysAgo);
        scoredMatches.push({
          user: {
            _id: user._id,
            name: user.name,
            role: user.role,
            distance: distance.toFixed(2),
            email: user.email,
          },
          score,
          distance,
        });
      }
    }

    scoredMatches.sort((a, b) => b.score - a.score);

    // ─── Real-time emergency broadcast via Socket.io ─────────────────────────
    const notifiedSocketIds = [];

    if (io && typeof io.getNearbyEligibleRecipients === 'function' &&
        (req.user.role === 'Hospital' || req.user.role === 'Blood Bank')) {

      const connectedRecipients = io.getNearbyEligibleRecipients({
        latitude: lat,
        longitude: lng,
        bloodGroup,
        radiusKm: 5,
        excludeUserId: req.user._id,
      });

      console.log(
        `[Request] ${new Date().toISOString()} Broadcasting INCOMING_EMERGENCY to ${connectedRecipients.length} connected donor(s) for request ${request._id}.`
      );

      connectedRecipients.forEach((recipient) => {
        io.to(recipient.socketId).emit('INCOMING_EMERGENCY', {
          requestId: request._id,
          message: `Emergency: ${bloodGroup} needed ${recipient.distance.toFixed(1)}km away`,
          bloodGroup,
          urgency: urgency || 'Medium',
          currentRegion,
          hospital: requester?.name || req.user.name,
          hospitalId: requester?._id || req.user._id,
          requesterRole: req.user.role,
          distance: recipient.distance.toFixed(1),
          hospitalCoords: { latitude: lat, longitude: lng },
          createdAt: request.createdAt,
          expiresAt,
        });
        notifiedSocketIds.push(recipient.socketId);
      });

      // Register notified sockets so we can send expiry events later
      if (typeof io.trackNotifiedSockets === 'function') {
        io.trackNotifiedSockets(request._id, notifiedSocketIds);
      }

      // Schedule automatic expiry broadcast after 15 minutes
      setTimeout(() => {
        if (typeof io.emitRequestExpired === 'function') {
          io.emitRequestExpired(request._id, expiresAt);
        }

        // Also update the request status to Expired if still Pending
        Request.findOneAndUpdate(
          { _id: request._id, status: 'Pending' },
          { $set: { status: 'Expired' } }
        ).catch((err) => console.error('[Request] Failed to mark request as Expired:', err));

        console.log(`[Request] ${new Date().toISOString()} Request ${request._id} expired — notified ${notifiedSocketIds.length} donor(s).`);
      }, EMERGENCY_EXPIRY_MS);
    }

    res.status(201).json({ request, matches: scoredMatches });
  } catch (error) {
    console.error('createRequest error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const getMyRequests = async (req, res) => {
  try {
    const requests = await Request.find({ requester: req.user._id }).populate('handledBy', 'name').sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const getIncomingRequests = async (req, res) => {
  try {
    const requests = await Request
      .find({ currentRegion: req.user.currentRegion })
      .populate('requester', 'name email location currentRegion')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const updateRequestStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user._id;
    const userName = req.user.name;

    if (status === 'Accepted') {
      const updated = await Request.findOneAndUpdate(
        { _id: req.params.id, status: 'Pending' },
        {
          $set: { status: 'Accepted', handledBy: (req.user.role === 'Hospital' || req.user.role === 'Blood Bank') ? userId : undefined },
          $addToSet: { acceptedBy: userId },
        },
        { new: true }
      );

      if (!updated) {
        const exists = await Request.findById(req.params.id);
        if (!exists) return res.status(404).json({ message: 'Request not found' });
        return res.status(409).json({ message: 'Request already accepted by another responder.' });
      }

      const io = req.app.get('io');
      if (io) {
        io.to(updated.requester.toString()).emit('request-accepted', {
          requestId: updated._id,
          message: `Your request has been accepted by ${userName}`,
        });
        io.emit('request-updated', { requestId: updated._id, status: 'Accepted' });
      }

      return res.json(updated);
    }

    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    request.status = status;
    const saved = await request.save();
    res.json(saved);
  } catch (error) {
    console.error('updateRequestStatus error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const getRequestMatches = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    const hospital = await User.findById(req.user._id);
    const internalMatches = hospital.internalDonorDatabase
      .filter((donor) => {
        const compat = getCompatibility(donor.bloodGroup, request.bloodGroup);
        return compat !== 'Not compatible' && donor.isAvailable !== false && checkEligibility(donor.lastDonationDate) && donor.is_eligible !== false;
      })
      .map((donor) => {
        const compat = getCompatibility(donor.bloodGroup, request.bloodGroup);
        const lastDonationDaysAgo = donor.lastDonationDate
          ? Math.floor((new Date() - new Date(donor.lastDonationDate)) / (1000 * 60 * 60 * 24))
          : null;
        const score = calculateScore(0, compat, true, lastDonationDaysAgo);
        return {
          _id: donor._id,
          name: donor.name,
          age: donor.age,
          type: 'Internal',
          bloodGroup: donor.bloodGroup,
          contact: donor.contact,
          barcodeId: donor.barcodeId,
          donationHistory: donor.donationHistory,
          score,
        };
      });

    const allUsers = await User.find({ role: 'User', _id: { $ne: request.requester }, currentRegion: request.currentRegion });
    const platformMatches = allUsers
      .filter((user) => {
        const compat = getCompatibility(user.bloodGroup, request.bloodGroup);
        return compat !== 'Not compatible' && user.isAvailable !== false && checkEligibility(user.lastDonationDate) && user.is_eligible !== false;
      })
      .map((user) => {
        const distance = getDistance(
          request.location.coordinates[1],
          request.location.coordinates[0],
          user.location.coordinates[1],
          user.location.coordinates[0]
        );
        const compat = getCompatibility(user.bloodGroup, request.bloodGroup);
        const lastDonationDaysAgo = user.lastDonationDate
          ? Math.floor((new Date() - new Date(user.lastDonationDate)) / (1000 * 60 * 60 * 24))
          : null;
        const score = calculateScore(distance, compat, true, lastDonationDaysAgo);
        return { _id: user._id, name: user.name, type: 'Platform', bloodGroup: user.bloodGroup, score, contact: user.contact, age: user.age };
      });

    res.json([...internalMatches, ...platformMatches].sort((a, b) => b.score - a.score));
  } catch (error) {
    console.error('getRequestMatches error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const assignDonor = async (req, res) => {
  try {
    const { assignedDonorId, phoneNumber } = req.body;
    const hospital = await User.findById(req.user._id);
    let targetDonor = null;
    let targetDonorType = null;

    if (hospital && hospital.internalDonorDatabase) {
      targetDonor = hospital.internalDonorDatabase.find(
        (d) => (d.barcodeId && d.barcodeId === assignedDonorId) || (d.contact && d.contact === phoneNumber)
      );
      if (targetDonor) targetDonorType = 'Internal';
    }

    if (!targetDonor && assignedDonorId && mongoose.isValidObjectId(assignedDonorId)) {
      targetDonor = await User.findById(assignedDonorId);
      if (targetDonor && targetDonor.role === 'User') targetDonorType = 'Platform';
      else targetDonor = null;
    }

    if (!targetDonor) return res.status(404).json({ message: 'User Not Found.' });
    if (targetDonor.is_eligible === false || !checkEligibility(targetDonor.lastDonationDate)) {
      const cdDate = targetDonor.lastDonationDate
        ? new Date(new Date(targetDonor.lastDonationDate).getTime() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString()
        : 'unknown';
      return res.status(403).json({ message: `User found but ineligible: 90-day cooldown active until ${cdDate}.` });
    }

    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    const now = new Date();
    if (targetDonorType === 'Internal') {
      targetDonor.lastDonationDate = now;
      targetDonor.is_eligible = false;
      targetDonor.donation_history.push(now);
      await hospital.save();
    } else {
      targetDonor.lastDonationDate = now;
      targetDonor.is_eligible = false;
      targetDonor.donation_history.push(now);
      await targetDonor.save();
    }

    request.assignedDonorId = targetDonorType === 'Internal' ? targetDonor.barcodeId : targetDonor._id.toString();
    request.assignedDonorType = targetDonorType;
    request.handledBy = req.user._id;
    request.status = 'Fulfilled';
    const updatedRequest = await request.save();

    const io = req.app.get('io');
    if (io) {
      // Notify the requester (hospital side listener)
      io.to(request.requester.toString()).emit('request-completed', {
        requestId: request._id,
        message: `Your blood request has been fulfilled by ${req.user.name}`,
      });

      // Notify the donor that the request is fulfilled so their Emergency Tab clears
      const donorId = targetDonorType === 'Platform' ? targetDonor._id.toString() : null;
      if (donorId) {
        io.to(donorId).emit('REQUEST_FULFILLED', {
          requestId: request._id,
          message: 'Thank you! The hospital has marked the request as fulfilled.',
        });
      }

      io.emit('request-updated', { requestId: request._id, status: 'Fulfilled' });
    }

    res.json(updatedRequest);
  } catch (error) {
    console.error('assignDonor error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createRequest,
  getMyRequests,
  getIncomingRequests,
  updateRequestStatus,
  getRequestMatches,
  assignDonor,
};
