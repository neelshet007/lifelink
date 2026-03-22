const Request = require('../models/Request');
const User = require('../models/User');
const { getDistance, calculateScore } = require('../utils/matchingAlgorithm');

// Blood compatibility check helper
const getCompatibility = (donorBloodGroup, requestedBloodGroup) => {
  if (!donorBloodGroup) return 'Not compatible';
  if (donorBloodGroup === requestedBloodGroup) return 'Exact';
  // O- is universal donor
  if (donorBloodGroup === 'O-') return 'Compatible';
  // AB+ can receive from anyone
  if (requestedBloodGroup === 'AB+') return 'Compatible';
  // Same base type, positive receiving from negative
  const base = (bg) => bg.replace('+', '').replace('-', '');
  const isPos = (bg) => bg.includes('+');
  if (base(donorBloodGroup) === base(requestedBloodGroup) && isPos(requestedBloodGroup) && !isPos(donorBloodGroup)) {
    return 'Compatible';
  }
  return 'Not compatible';
};

const isEligible = (lastDonationDate) => {
  if (!lastDonationDate) return true; // never donated, fully eligible
  const days = Math.floor((new Date() - new Date(lastDonationDate)) / (1000 * 60 * 60 * 24));
  return days >= 90;
};

// @desc    Create a new blood request + smart filtered notifications
// @route   POST /api/requests
const createRequest = async (req, res) => {
  try {
    const { bloodGroup, urgency, latitude, longitude } = req.body;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    const request = await Request.create({
      requester: req.user._id,
      bloodGroup,
      urgency: urgency || 'Medium',
      location: {
        type: 'Point',
        coordinates: [lng, lat]
      }
    });

    const maxDistanceInMeters = 20000; // 20 km

    // Find ALL nearby users and institutions
    const nearbyUsers = await User.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: maxDistanceInMeters
        }
      },
      _id: { $ne: req.user._id }
    });

    const io = req.app.get('io');
    const scoredMatches = [];

    for (const user of nearbyUsers) {
      const distance = getDistance(lat, lng, user.location.coordinates[1], user.location.coordinates[0]);
      let shouldNotify = false;
      let compatibility = 'Not compatible';

      if (user.role === 'Hospital' || user.role === 'Blood Bank') {
        // ALWAYS notify hospitals and blood banks
        shouldNotify = true;
        compatibility = 'Compatible';
      } else if (user.role === 'User') {
        // Smart filtering: only if blood compatible, available, and eligible
        compatibility = getCompatibility(user.bloodGroup, bloodGroup);
        const available = user.isAvailable !== false;
        const eligible = isEligible(user.lastDonationDate);
        shouldNotify = (compatibility !== 'Not compatible') && available && eligible;
      }

      if (shouldNotify) {
        const lastDonationDaysAgo = user.lastDonationDate
          ? Math.floor((new Date() - new Date(user.lastDonationDate)) / (1000 * 60 * 60 * 24))
          : null;
        const score = calculateScore(distance, compatibility, user.isAvailable !== false, lastDonationDaysAgo);

        scoredMatches.push({
          user: { _id: user._id, name: user.name, role: user.role, distance: distance.toFixed(2), email: user.email },
          score
        });

        if (io) {
          io.to(user._id.toString()).emit('new-blood-request', {
            requestId: request._id,
            message: `🚨 Urgent: A patient near you needs ${bloodGroup} blood. Please help!`,
            urgency: urgency || 'Medium',
            distance: distance.toFixed(2)
          });
        }
      }
    }

    scoredMatches.sort((a, b) => b.score - a.score);
    res.status(201).json({ request, matches: scoredMatches });

  } catch (error) {
    console.error('createRequest error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all requests made by current user
// @route   GET /api/requests/me
const getMyRequests = async (req, res) => {
  try {
    const requests = await Request.find({ requester: req.user._id })
      .populate('handledBy', 'name')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all pending/accepted incoming requests (for responders)
// @route   GET /api/requests/incoming
const getIncomingRequests = async (req, res) => {
  try {
    const requests = await Request.find({ status: { $in: ['Pending', 'Accepted'] } })
      .populate('requester', 'name email location')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Accept a request — ATOMIC to prevent race conditions
// @route   PUT /api/requests/:id/status
const updateRequestStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user._id;
    const userName = req.user.name;

    if (status === 'Accepted') {
      // Atomic findOneAndUpdate: only update if status is currently 'Pending'
      const updated = await Request.findOneAndUpdate(
        { _id: req.params.id, status: 'Pending' },
        {
          $set: { status: 'Accepted', handledBy: (req.user.role === 'Hospital' || req.user.role === 'Blood Bank') ? userId : undefined },
          $addToSet: { acceptedBy: userId }
        },
        { new: true }
      );

      if (!updated) {
        // Either not found or already accepted by someone else
        const exists = await Request.findById(req.params.id);
        if (!exists) return res.status(404).json({ message: 'Request not found' });
        return res.status(409).json({ message: 'Request already accepted by another responder.' });
      }

      const io = req.app.get('io');
      if (io) {
        // Notify the requester
        io.to(updated.requester.toString()).emit('request-accepted', {
          requestId: updated._id,
          message: `Your request has been accepted by ${userName}`
        });
        // Broadcast to ALL users so they remove this from their queue
        io.emit('request-updated', {
          requestId: updated._id,
          status: 'Accepted'
        });
      }

      return res.json(updated);
    }

    // For other status updates (non-critical path)
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

// @desc    Get combined scored matches (Platform + Internal) for hospital assignment
// @route   GET /api/requests/:id/matches
const getRequestMatches = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    const hospital = await User.findById(req.user._id);

    // Internal Donors — strictly filtered
    const internalMatches = hospital.internalDonorDatabase
      .filter(donor => {
        const compat = getCompatibility(donor.bloodGroup, request.bloodGroup);
        return compat !== 'Not compatible' && donor.isAvailable !== false && isEligible(donor.lastDonationDate);
      })
      .map(donor => {
        const compat = getCompatibility(donor.bloodGroup, request.bloodGroup);
        const lastDonationDaysAgo = donor.lastDonationDate
          ? Math.floor((new Date() - new Date(donor.lastDonationDate)) / (1000 * 60 * 60 * 24))
          : null;
        const score = calculateScore(0, compat, true, lastDonationDaysAgo);
        return { _id: donor._id, name: donor.name, type: 'Internal', bloodGroup: donor.bloodGroup, contact: donor.contact, score };
      });

    // Platform Users — strictly filtered
    const allUsers = await User.find({
      role: 'User',
      _id: { $ne: request.requester }
    });

    const platformMatches = allUsers
      .filter(user => {
        const compat = getCompatibility(user.bloodGroup, request.bloodGroup);
        return compat !== 'Not compatible' && user.isAvailable !== false && isEligible(user.lastDonationDate);
      })
      .map(user => {
        const distance = getDistance(
          request.location.coordinates[1], request.location.coordinates[0],
          user.location.coordinates[1], user.location.coordinates[0]
        );
        const compat = getCompatibility(user.bloodGroup, request.bloodGroup);
        const lastDonationDaysAgo = user.lastDonationDate
          ? Math.floor((new Date() - new Date(user.lastDonationDate)) / (1000 * 60 * 60 * 24))
          : null;
        const score = calculateScore(distance, compat, true, lastDonationDaysAgo);
        return { _id: user._id, name: user.name, type: 'Platform', bloodGroup: user.bloodGroup, score };
      });

    const allMatches = [...internalMatches, ...platformMatches].sort((a, b) => b.score - a.score);
    res.json(allMatches);

  } catch (error) {
    console.error('getRequestMatches error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Assign a donor and complete request
// @route   PUT /api/requests/:id/assign
const assignDonor = async (req, res) => {
  try {
    const { assignedDonorId, assignedDonorType, patientName, barcode } = req.body;

    if (!patientName || !barcode) {
      return res.status(400).json({ message: 'Patient Name and Barcode ID are required to complete the request.' });
    }

    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    request.assignedDonorId = assignedDonorId;
    request.assignedDonorType = assignedDonorType;
    request.handledBy = req.user._id;
    request.status = 'Completed';
    const updatedRequest = await request.save();

    const io = req.app.get('io');
    if (io) {
      io.to(request.requester.toString()).emit('request-completed', {
        requestId: request._id,
        message: `Your blood request has been fulfilled by ${req.user.name}`
      });
      // Broadcast removal to all
      io.emit('request-updated', { requestId: request._id, status: 'Completed' });
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
  assignDonor
};
