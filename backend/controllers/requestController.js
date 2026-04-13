const mongoose = require('mongoose');
const Request = require('../models/Request');
const User = require('../models/User');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const { getDistance, calculateScore, isBloodGroupCompatible } = require('../utils/matchingAlgorithm');

// ── Prototype mode: all eligibility/cooldown checks are bypassed ─────────────
const getCompatibility = (donorBloodGroup, requestedBloodGroup) => {
  if (!donorBloodGroup) return 'Not compatible';
  if (donorBloodGroup === requestedBloodGroup) return 'Exact';
  return isBloodGroupCompatible(donorBloodGroup, requestedBloodGroup) ? 'Compatible' : 'Not compatible';
};

const checkEligibility = () => true; // bypassed for prototype

const resolveUserBloodGroup = async (user) => {
  if (user?.abhaAddress) {
    const sandboxProfile = await MockSandboxRegistry.findOne({ abhaAddress: user.abhaAddress.toLowerCase() }).select('bloodGroup');
    if (sandboxProfile?.bloodGroup) return sandboxProfile.bloodGroup;
  }

  return user?.bloodGroup || '';
};

const createRequest = async (req, res) => {
  try {
    const { bloodGroup, urgency, requestType, bloodUnits } = req.body;

    // ── Step 1: Resolve the sender from the database (source of truth) ──────────
    // We read the name directly from the DB document, NOT from the JWT or socket
    // session, to prevent the identity-swap bug.
    const requesterDoc = await User.findById(req.user._id).select('name role location hfrFacilityId dcgiLicenseNumber abhaAddress');
    if (!requesterDoc) {
      return res.status(404).json({ message: 'Requesting user not found.' });
    }

    const io = req.app.get('io');
    const activeSession = io?.getSessionByUserId?.(req.user._id);

    const latitude  = Number(activeSession?.latitude  ?? requesterDoc.location?.coordinates?.[1]);
    const longitude = Number(activeSession?.longitude ?? requesterDoc.location?.coordinates?.[0]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: 'Live coordinates are required before creating a request.' });
    }

    const senderId =
      requesterDoc.role === 'Hospital'   ? requesterDoc.hfrFacilityId    :
      requesterDoc.role === 'Blood Bank' ? requesterDoc.dcgiLicenseNumber :
                                           requesterDoc.abhaAddress;

    // ── Step 2: Save to MongoDB with senderName locked as a static String ────────
    // senderName is NEVER populated from a socket session or JWT claim —
    // only from the DB document loaded above. It will not change for the
    // lifetime of this request document.
    const request = await Request.create({
      requester:  requesterDoc._id,
      senderName: requesterDoc.name,          // static — frozen at creation
      senderType: requesterDoc.role,
      senderId:   senderId || 'SYSTEM',
      bloodGroup,
      bloodUnits: bloodUnits || 1,
      urgency:    urgency || 'Standard',
      requestType: requestType || 'Blood Request',
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
      status: 'Pending',
    });

    // ── Step 3: Signal the mesh via socket (DB save already complete) ─────────────
    // Only send the minimal safe payload. We do NOT include the requester's full
    // user object — only identifiers and the frozen senderName from the DB record.
    if (io) {
      const activeSessions = io.getActiveSessions?.();
      if (activeSessions) {
        const { getDistance: gd } = require('../utils/matchingAlgorithm');
        const USER_RADIUS     = 5;
        const FACILITY_RADIUS = 10;
        let notified = 0;

        for (const [, session] of activeSessions.entries()) {
          if (String(session.userId) === String(requesterDoc._id)) continue;
          if (!Number.isFinite(session.latitude) || !Number.isFinite(session.longitude)) continue;

          const dist  = gd(latitude, longitude, session.latitude, session.longitude);
          const limit = session.role === 'User' ? USER_RADIUS : FACILITY_RADIUS;
          if (dist > limit) continue;

          // Minimal mesh payload — only what the recipient needs to render the alert.
          // senderName comes from the DB record, not from the session or JWT.
          const meshPayload = {
            requestId:   request._id,
            senderName:  request.senderName,   // ← DB-frozen value
            senderType:  request.senderType,
            bloodGroup:  request.bloodGroup,
            bloodUnits:  request.bloodUnits,
            urgency:     request.urgency,
            requestType: request.requestType,
            distanceKm:  Number(dist.toFixed(2)),
            distance:    dist.toFixed(1),
            senderCoords: { latitude, longitude },
          };

          io.to(session.socketId).emit('GLOBAL_EMERGENCY_DATA', meshPayload);

          // Legacy event for the User EmergencyActionDock
          if (session.role === 'User') {
            io.to(session.socketId).emit('INCOMING_EMERGENCY', {
              ...meshPayload,
              hospital:      request.senderName,
              hospitalType:  request.senderType,
              hospitalCoords: { latitude, longitude },
              message: `${request.senderType} (${request.senderName}) needs ${bloodGroup} — ${dist.toFixed(1)} km away`,
            });
          }

          notified++;
        }

        request.notifiedDonorCount = notified;
        await request.save();
      }
    }

    return res.status(201).json({
      request,
      meta: {
        notifiedCount: request.notifiedDonorCount,
        coords: { latitude, longitude },
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

const getExternalRequirements = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('location role');
    if (user.role !== 'Blood Bank' && user.role !== 'Hospital') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const latitude = user?.location?.coordinates?.[1];
    const longitude = user?.location?.coordinates?.[0];

    // Find all pending requests (not created by self)
    const requests = await Request
      .find({ 
        status: { $in: ['Pending', 'Stock Confirmed'] },
        requester: { $ne: req.user._id }
      })
      .populate('requester', 'name role')
      .sort({ createdAt: -1 });

    const filtered = requests.filter((request) => {
      const requestLatitude = request.location?.coordinates?.[1];
      const requestLongitude = request.location?.coordinates?.[0];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      if (!Number.isFinite(requestLatitude) || !Number.isFinite(requestLongitude)) return false;
      
      const distance = getDistance(latitude, longitude, requestLatitude, requestLongitude);
      // Facilities see requests within 10km
      return distance <= 10;
    });

    return res.json(filtered);
  } catch (error) {
    console.error('getExternalRequirements error:', error);
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
  getExternalRequirements,
  updateRequestStatus,
  getRequestMatches,
  assignDonor,
};
