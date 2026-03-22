const Request = require('../models/Request');
const User = require('../models/User');
const { getDistance, calculateScore } = require('../utils/matchingAlgorithm');

// @desc    Create a new blood request
// @route   POST /api/requests
const createRequest = async (req, res) => {
  try {
    const { bloodGroup, urgency, latitude, longitude } = req.body;

    const request = await Request.create({
      requester: req.user._id,
      bloodGroup,
      urgency,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      }
    });

    const maxDistanceInMeters = 20000; // 20 km
    
    // Find nearby Users, Hospitals, Blood Banks
    const nearbyUsers = await User.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: maxDistanceInMeters
        }
      },
      role: { $in: ['User', 'Hospital', 'Blood Bank'] },
      _id: { $ne: req.user._id }
    });

    const scoredMatches = nearbyUsers.map(user => {
      const distance = getDistance(
        parseFloat(latitude), parseFloat(longitude),
        user.location.coordinates[1], user.location.coordinates[0]
      );
      
      let bloodCompatibility = 'Not compatible';
      if (user.role === 'User') {
        if (user.bloodGroup === bloodGroup) bloodCompatibility = 'Exact';
        else if (bloodGroup.includes('+') && user.bloodGroup.includes('-') && user.bloodGroup[0] === bloodGroup[0]) {
           bloodCompatibility = 'Compatible';
        }
        else if (user.bloodGroup === 'O-') bloodCompatibility = 'Compatible'; 
        else if (bloodGroup === 'AB+') bloodCompatibility = 'Compatible'; 
      } else {
        bloodCompatibility = 'Compatible';
      }

      const lastDonationDaysAgo = user.lastDonationDate ? 
        Math.floor((new Date() - new Date(user.lastDonationDate)) / (1000 * 60 * 60 * 24)) : null;

      const score = calculateScore(distance, bloodCompatibility, user.isAvailable !== false, lastDonationDaysAgo);

      return {
        user: {
          _id: user._id,
          name: user.name,
          role: user.role,
          distance: distance.toFixed(2),
          email: user.email
        },
        score
      };
    }).filter(match => match.score > 0).sort((a, b) => b.score - a.score);

    // Socket.io Notification
    const io = req.app.get('io');
    if (io) {
      scoredMatches.forEach(match => {
        const notification = {
          requestId: request._id,
          message: `🚨 Urgent: A patient near you needs ${bloodGroup} blood. Please help!`,
          urgency,
          distance: match.user.distance
        };
        io.to(match.user._id.toString()).emit('new-blood-request', notification);
      });
    }

    res.status(201).json({
      request,
      matches: scoredMatches
    });

  } catch (error) {
    console.error(error);
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

// @desc    Get all incoming requests (For nearby Donors, Hospitals)
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

// @desc    Update request status
// @route   PUT /api/requests/:id/status
const updateRequestStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (status === 'Accepted') {
      request.status = status;
      if (!request.acceptedBy.includes(req.user._id)) {
        request.acceptedBy.push(req.user._id);
      }
      if (req.user.role === 'Hospital' || req.user.role === 'Blood Bank') {
        request.handledBy = req.user._id;
      }
      
      const io = req.app.get('io');
      if (io) {
        io.to(request.requester.toString()).emit('request-accepted', {
          requestId: request._id,
          message: `Your request has been accepted by ${req.user.name}`
        });
      }
    } else {
      request.status = status;
    }

    const updatedRequest = await request.save();
    res.json(updatedRequest);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get combined matches (Platform + Internal) when Hospital accepts
// @route   GET /api/requests/:id/matches
const getRequestMatches = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    
    // Internal Donors
    const hospital = await User.findById(req.user._id);
    const internalMatches = hospital.internalDonorDatabase.map(donor => {
      let bloodCompatibility = 'Not compatible';
      if (donor.bloodGroup === request.bloodGroup) bloodCompatibility = 'Exact';
      else if (request.bloodGroup.includes('+') && donor.bloodGroup.includes('-') && donor.bloodGroup[0] === request.bloodGroup[0]) {
         bloodCompatibility = 'Compatible';
      }
      else if (donor.bloodGroup === 'O-') bloodCompatibility = 'Compatible'; 
      else if (request.bloodGroup === 'AB+') bloodCompatibility = 'Compatible'; 

      const lastDonationDaysAgo = donor.lastDonationDate ? 
        Math.floor((new Date() - new Date(donor.lastDonationDate)) / (1000 * 60 * 60 * 24)) : null;

      const score = calculateScore(0, bloodCompatibility, donor.isAvailable !== false, lastDonationDaysAgo);

      return {
        _id: donor._id,
        name: donor.name,
        type: 'Internal',
        bloodGroup: donor.bloodGroup,
        score
      };
    }).filter(m => m.score > 0);

    // Platform Users
    const nearbyPlatformUsers = await User.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: request.location.coordinates },
          $maxDistance: 20000
        }
      },
      role: 'User',
      _id: { $ne: request.requester }
    });

    const platformMatches = nearbyPlatformUsers.map(user => {
      const distance = getDistance(
        request.location.coordinates[1], request.location.coordinates[0],
        user.location.coordinates[1], user.location.coordinates[0]
      );
      
      let bloodCompatibility = 'Not compatible';
      if (user.bloodGroup === request.bloodGroup) bloodCompatibility = 'Exact';
      else if (request.bloodGroup.includes('+') && user.bloodGroup.includes('-') && user.bloodGroup[0] === request.bloodGroup[0]) {
         bloodCompatibility = 'Compatible';
      }
      else if (user.bloodGroup === 'O-') bloodCompatibility = 'Compatible'; 
      else if (request.bloodGroup === 'AB+') bloodCompatibility = 'Compatible'; 

      const lastDonationDaysAgo = user.lastDonationDate ? 
        Math.floor((new Date() - new Date(user.lastDonationDate)) / (1000 * 60 * 60 * 24)) : null;

      const score = calculateScore(distance, bloodCompatibility, user.isAvailable !== false, lastDonationDaysAgo);

      return {
        _id: user._id,
        name: user.name,
        type: 'Platform',
        bloodGroup: user.bloodGroup,
        score
      };
    }).filter(m => m.score > 0);

    const allMatches = [...internalMatches, ...platformMatches].sort((a, b) => b.score - a.score);
    res.json(allMatches);

  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Assign a specific donor and complete request
// @route   PUT /api/requests/:id/assign
const assignDonor = async (req, res) => {
  try {
    const { assignedDonorId, assignedDonorType } = req.body;
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
        message: `Your request has been assigned a donor and fulfilled by ${req.user.name}`
      });
    }

    res.json(updatedRequest);
  } catch (error) {
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
