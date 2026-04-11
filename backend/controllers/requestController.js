const mongoose = require('mongoose');
const Request = require('../models/Request');
const User = require('../models/User');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const { getDistance, calculateScore, isBloodGroupCompatible } = require('../utils/matchingAlgorithm');

const EMERGENCY_EXPIRY_MS = 15 * 60 * 1000;

const getCompatibility = (donorBloodGroup, requestedBloodGroup) => {
  if (!donorBloodGroup) return 'Not compatible';
  if (donorBloodGroup === requestedBloodGroup) return 'Exact';
  return isBloodGroupCompatible(donorBloodGroup, requestedBloodGroup) ? 'Compatible' : 'Not compatible';
};

const checkEligibility = (lastDonationDate) => {
  if (!lastDonationDate) return true;
  const days = Math.floor((Date.now() - new Date(lastDonationDate).getTime()) / (1000 * 60 * 60 * 24));
  return days >= 90;
};

const resolveUserBloodGroup = async (user) => {
  if (user?.abhaAddress) {
    const sandboxProfile = await MockSandboxRegistry.findOne({ abhaAddress: user.abhaAddress.toLowerCase() }).select('bloodGroup');
    if (sandboxProfile?.bloodGroup) return sandboxProfile.bloodGroup;
  }

  return user?.bloodGroup || '';
};

const createRequest = async (req, res) => {
  try {
    const { bloodGroup, urgency } = req.body;
    const requester = await User.findById(req.user._id);
    const io = req.app.get('io');
    const activeSession = io?.getSessionByUserId?.(req.user._id);
    const latitude = Number(activeSession?.latitude ?? requester?.location?.coordinates?.[1]);
    const longitude = Number(activeSession?.longitude ?? requester?.location?.coordinates?.[0]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: 'Live hospital coordinates are required before creating an emergency request.' });
    }

    const request = await Request.create({
      requester: req.user._id,
      bloodGroup,
      urgency: urgency || 'Medium',
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
    });

    const expiresAt = new Date(request.createdAt.getTime() + EMERGENCY_EXPIRY_MS).toISOString();
    const notifiedSocketIds = [];
    const scoredMatches = [];

    if (io && typeof io.getNearbyEligibleRecipients === 'function' &&
      (req.user.role === 'Hospital' || req.user.role === 'Blood Bank')) {
      const recipients = io.getNearbyEligibleRecipients({
        latitude,
        longitude,
        bloodGroup,
        radiusKm: 5,
        excludeUserId: req.user._id,
      });

      const recipientUsers = await User.find({
        _id: { $in: recipients.map((recipient) => recipient.userId) },
      }).select('name email isAvailable is_eligible lastDonationDate abhaAddress bloodGroup');

      const userMap = new Map(recipientUsers.map((user) => [String(user._id), user]));

      for (const recipient of recipients) {
        const donor = userMap.get(String(recipient.userId));
        if (!donor) continue;

        const donorBloodGroup = await resolveUserBloodGroup(donor);
        const compatibility = getCompatibility(donorBloodGroup, bloodGroup);
        const available = donor.isAvailable !== false;
        const eligible = donor.is_eligible !== false && checkEligibility(donor.lastDonationDate);

        if (compatibility === 'Not compatible' || !available || !eligible) {
          continue;
        }

        const lastDonationDaysAgo = donor.lastDonationDate
          ? Math.floor((Date.now() - new Date(donor.lastDonationDate).getTime()) / (1000 * 60 * 60 * 24))
          : null;

        scoredMatches.push({
          user: {
            _id: donor._id,
            name: donor.name,
            role: 'User',
            distance: recipient.distanceKm.toFixed(2),
            email: donor.email,
          },
          score: calculateScore(recipient.distanceKm, compatibility, available, lastDonationDaysAgo),
          distance: recipient.distanceKm,
        });

        io.to(recipient.socketId).emit('INCOMING_EMERGENCY', {
          requestId: request._id,
          bloodGroup,
          urgency: urgency || 'Medium',
          hospital: requester?.name || req.user.name,
          hospitalId: requester?._id || req.user._id,
          requesterRole: req.user.role,
          message: `Emergency: ${bloodGroup} needed ${recipient.distanceKm.toFixed(1)} km away`,
          distance: recipient.distanceKm.toFixed(1),
          distanceKm: Number(recipient.distanceKm.toFixed(2)),
          hospitalCoords: { latitude, longitude },
          createdAt: request.createdAt,
          expiresAt,
        });

        notifiedSocketIds.push(recipient.socketId);
      }

      scoredMatches.sort((a, b) => b.score - a.score);
      request.notifiedDonorCount = notifiedSocketIds.length;
      await request.save();

      if (typeof io.trackNotifiedSockets === 'function') {
        io.trackNotifiedSockets(request._id, notifiedSocketIds);
      }

      setTimeout(() => {
        if (typeof io.emitRequestExpired === 'function') {
          io.emitRequestExpired(request._id, expiresAt);
        }

        Request.findOneAndUpdate(
          { _id: request._id, status: 'Pending' },
          { $set: { status: 'Expired' } }
        ).catch((err) => console.error('[Request] Failed to mark request as expired:', err));
      }, EMERGENCY_EXPIRY_MS);
    }

    return res.status(201).json({
      request,
      matches: scoredMatches,
      meta: {
        notifiedDonorCount: notifiedSocketIds.length,
        radiusKm: 5,
        hospitalCoords: { latitude, longitude },
      },
    });
  } catch (error) {
    console.error('createRequest error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const getMyRequests = async (req, res) => {
  try {
    const requests = await Request.find({ requester: req.user._id }).populate('handledBy', 'name').sort({ createdAt: -1 });
    return res.json(requests);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};

const getIncomingRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('location bloodGroup abhaAddress');
    const donorBloodGroup = await resolveUserBloodGroup(user);
    const latitude = user?.location?.coordinates?.[1];
    const longitude = user?.location?.coordinates?.[0];

    const requests = await Request
      .find({ status: 'Pending' })
      .populate('requester', 'name email location')
      .sort({ createdAt: -1 });

    const nearbyRequests = requests.filter((request) => {
      const requestLatitude = request.location?.coordinates?.[1];
      const requestLongitude = request.location?.coordinates?.[0];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      if (!Number.isFinite(requestLatitude) || !Number.isFinite(requestLongitude)) return false;
      if (!isBloodGroupCompatible(donorBloodGroup, request.bloodGroup)) return false;
      return getDistance(latitude, longitude, requestLatitude, requestLongitude) <= 5;
    });

    return res.json(nearbyRequests);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
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
    return res.json(saved);
  } catch (error) {
    console.error('updateRequestStatus error:', error);
    return res.status(500).json({ message: 'Server error' });
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
          ? Math.floor((Date.now() - new Date(donor.lastDonationDate).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          _id: donor._id,
          name: donor.name,
          age: donor.age,
          type: 'Internal',
          bloodGroup: donor.bloodGroup,
          contact: donor.contact,
          barcodeId: donor.barcodeId,
          donationHistory: donor.donationHistory,
          score: calculateScore(0, compat, true, lastDonationDaysAgo),
        };
      });

    const allUsers = await User.find({ role: 'User', _id: { $ne: request.requester } });
    const platformMatches = allUsers
      .filter((user) => {
        const compat = getCompatibility(user.bloodGroup, request.bloodGroup);
        if (compat === 'Not compatible') return false;
        if (user.isAvailable === false || user.is_eligible === false || !checkEligibility(user.lastDonationDate)) return false;
        const userLat = user.location?.coordinates?.[1];
        const userLng = user.location?.coordinates?.[0];
        const requestLat = request.location?.coordinates?.[1];
        const requestLng = request.location?.coordinates?.[0];
        return Number.isFinite(userLat) && Number.isFinite(userLng) && getDistance(requestLat, requestLng, userLat, userLng) <= 5;
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
          ? Math.floor((Date.now() - new Date(user.lastDonationDate).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          _id: user._id,
          name: user.name,
          type: 'Platform',
          bloodGroup: user.bloodGroup,
          score: calculateScore(distance, compat, true, lastDonationDaysAgo),
          contact: user.contact,
          age: user.age,
          distance: Number(distance.toFixed(2)),
        };
      });

    return res.json([...internalMatches, ...platformMatches].sort((a, b) => b.score - a.score));
  } catch (error) {
    console.error('getRequestMatches error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const assignDonor = async (req, res) => {
  try {
    const { assignedDonorId, phoneNumber } = req.body;
    const hospital = await User.findById(req.user._id);
    let targetDonor = null;
    let targetDonorType = null;

    if (hospital?.internalDonorDatabase) {
      targetDonor = hospital.internalDonorDatabase.find(
        (donor) => (donor.barcodeId && donor.barcodeId === assignedDonorId) || (donor.contact && donor.contact === phoneNumber)
      );
      if (targetDonor) targetDonorType = 'Internal';
    }

    if (!targetDonor && assignedDonorId && mongoose.isValidObjectId(assignedDonorId)) {
      targetDonor = await User.findById(assignedDonorId);
      if (targetDonor?.role === 'User') targetDonorType = 'Platform';
      else targetDonor = null;
    }

    if (!targetDonor) return res.status(404).json({ message: 'User Not Found.' });
    if (targetDonor.is_eligible === false || !checkEligibility(targetDonor.lastDonationDate)) {
      const cooldownDate = targetDonor.lastDonationDate
        ? new Date(new Date(targetDonor.lastDonationDate).getTime() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString()
        : 'unknown';
      return res.status(403).json({ message: `User found but ineligible: 90-day cooldown active until ${cooldownDate}.` });
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
      io.to(request.requester.toString()).emit('request-completed', {
        requestId: request._id,
        message: `Your blood request has been fulfilled by ${req.user.name}`,
      });

      const donorId = targetDonorType === 'Platform' ? targetDonor._id.toString() : null;
      if (donorId) {
        io.to(donorId).emit('REQUEST_FULFILLED', {
          requestId: request._id,
          message: 'Thank you! The hospital has marked the request as fulfilled.',
        });
      }

      io.emit('request-updated', { requestId: request._id, status: 'Fulfilled' });
    }

    return res.json(updatedRequest);
  } catch (error) {
    console.error('assignDonor error:', error);
    return res.status(500).json({ message: 'Server error' });
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
