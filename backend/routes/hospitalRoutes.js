const express = require('express');
const router = express.Router();
const { addInternalDonor, getInternalDonors, updateInternalDonor } = require('../controllers/hospitalController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);
router.use(authorize('Hospital', 'Blood Bank'));

router.post('/donors', addInternalDonor);
router.get('/donors', getInternalDonors);
router.put('/donors/:id', updateInternalDonor);

module.exports = router;
