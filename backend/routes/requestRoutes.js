const express = require('express');
const router = express.Router();
const { createRequest, getMyRequests, getIncomingRequests, updateRequestStatus } = require('../controllers/requestController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/', protect, authorize('Patient', 'Hospital'), createRequest);
router.get('/me', protect, getMyRequests);
router.get('/incoming', protect, authorize('Donor', 'Hospital', 'Blood Bank'), getIncomingRequests);
router.put('/:id/status', protect, updateRequestStatus);

module.exports = router;
