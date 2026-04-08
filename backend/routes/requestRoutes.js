const express = require('express');
const router = express.Router();
const { createRequest, getMyRequests, getIncomingRequests, updateRequestStatus, getRequestMatches, assignDonor } = require('../controllers/requestController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/', protect, authorize('User', 'Hospital', 'Blood Bank'), createRequest);
router.get('/me', protect, getMyRequests);
router.get('/incoming', protect, authorize('User', 'Hospital', 'Blood Bank'), getIncomingRequests);
router.put('/:id/status', protect, updateRequestStatus);
router.get('/:id/matches', protect, authorize('Hospital', 'Blood Bank'), getRequestMatches);
router.put('/:id/assign', protect, authorize('Hospital', 'Blood Bank'), assignDonor);

module.exports = router;
