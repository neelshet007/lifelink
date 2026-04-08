const express = require('express');
const router = express.Router();
const {
  addInternalDonor,
  getInternalDonors,
  updateInternalDonor,
  fetchSandboxProfile,
  addSandboxProfileToLedger,
  getFacilityLedger,
  exportFacilityLedger,
} = require('../controllers/hospitalController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);
router.use(authorize('Hospital', 'Blood Bank'));

router.post('/donors', addInternalDonor);
router.get('/donors', getInternalDonors);
router.put('/donors/:id', updateInternalDonor);
router.get('/sandbox-profile/:abhaAddress', fetchSandboxProfile);
router.post('/ledger/intake', addSandboxProfileToLedger);
router.get('/ledger', getFacilityLedger);
router.get('/ledger/export', exportFacilityLedger);

module.exports = router;
