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
    
    // Find nearby Donors, Hospitals, Blood Banks
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
      role: { $in: ['Donor', 'Hospital', 'Blood Bank'] },
      _id: { $ne: req.user._id }
    });

    // Score and filter
    const scoredMatches = nearbyUsers.map(user => {
      const distance = getDistance(
        parseFloat(latitude), parseFloat(longitude),
        user.location.coordinates[1], user.location.coordinates[0]
      );
      
      let bloodCompatibility = 'Not compatible';
      if (user.role === 'Donor') {
        if (user.bloodGroup === bloodGroup) bloodCompatibility = 'Exact';
        else if (bloodGroup.includes('+') && user.bloodGroup.includes('-') && user.bloodGroup[0] === bloodGroup[0]) {
           bloodCompatibility = 'Compatible';
        }
        else if (user.bloodGroup === 'O-') bloodCompatibility = 'Compatible'; // Universal donor
        else if (bloodGroup === 'AB+') bloodCompatibility = 'Compatible'; // Universal recipient
      } else {
        // Hospitals and Blood Banks are generally compatible sources
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
        // Emit only to the specific user's room
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
    const requests = await Request.find({ requester: req.user._id }).sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all incoming requests (For nearby Donors, Hospitals)
// @route   GET /api/requests/incoming
const getIncomingRequests = async (req, res) => {
  try {
    // In a real app, you'd match by user's location & blood group. Here returning pending.
    const requests = await Request.find({ status: 'Pending' })
      .populate('requester', 'name email')
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

    if (status === 'Fulfilled') {
      request.status = status;
      request.fulfilledBy = req.user._id;
    } else if (status === 'Accepted') {
      request.status = status;
      if (!request.acceptedBy.includes(req.user._id)) {
        request.acceptedBy.push(req.user._id);
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

module.exports = {
  createRequest,
  getMyRequests,
  getIncomingRequests,
  updateRequestStatus
};
