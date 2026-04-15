/**
 * ============================================================
 * FILE: backend/routes/hospitalRoutes.js
 * ROLE: Express Router — maps /api/hospital/* to hospitalController
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * All routes under /api/hospital/* are exclusively for facilities
 * (Hospital or Blood Bank role). Two blanket middlewares apply to
 * the entire router via router.use():
 *
 *   protect   → verifies JWT, attaches req.user
 *   authorize → rejects anyone whose role is not Hospital or Blood Bank
 *
 * This means no individual route needs to repeat these guards.
 *
 * ENDPOINT GUIDE
 * ──────────────
 * POST /donors
 *   Adds a new walk-in donor to the hospital's internalDonorDatabase
 *   sub-array (stored inside the hospital's own User document).
 *   Body: { name, age, bloodGroup, contact, barcodeId, ... }
 *   → hospitalController.addInternalDonor
 *
 * GET /donors
 *   Returns the hospital's full internalDonorDatabase, sorted by most recent.
 *   → hospitalController.getInternalDonors
 *
 * PUT /donors/:id
 *   Updates a specific internal donor sub-document by its MongoDB _id.
 *   Body: any subset of donor fields (name, bloodGroup, isAvailable, etc.)
 *   → hospitalController.updateInternalDonor
 *
 * GET /sandbox-profile/:abhaAddress
 *   Looks up a citizen in MockSandboxRegistry by their ABHA address.
 *   Used by hospitals to verify a donor's identity before intake.
 *   → hospitalController.fetchSandboxProfile
 *
 * POST /ledger/intake
 *   Adds a verified ABHA citizen to the hospital's FacilityLedger
 *   (a separate collection logging all officially processed donors).
 *   Body: { abhaAddress, bloodGroup, donationDate, ... }
 *   → hospitalController.addSandboxProfileToLedger
 *
 * GET /ledger
 *   Returns the hospital's full FacilityLedger (audit trail of all
 *   donors processed through the ABHA verification flow).
 *   → hospitalController.getFacilityLedger
 *
 * GET /ledger/export
 *   Returns the ledger in a CSV-friendly format for reporting.
 *   → hospitalController.exportFacilityLedger
 */

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

// Blanket guards — apply to ALL routes in this router.
// Any unauthenticated or non-facility request is rejected here before
// reaching any controller.
router.use(protect);                          // verifies JWT → attaches req.user
router.use(authorize('Hospital', 'Blood Bank')); // role check → 403 if not facility

// Internal donor management (stored as sub-documents in the facility's User document)
router.post('/donors', addInternalDonor);
router.get('/donors', getInternalDonors);
router.put('/donors/:id', updateInternalDonor);

// ABDM Sandbox verification — looks up a citizen before intake
router.get('/sandbox-profile/:abhaAddress', fetchSandboxProfile);

// Facility ledger — official processing audit trail (separate FacilityLedger collection)
router.post('/ledger/intake', addSandboxProfileToLedger);
router.get('/ledger', getFacilityLedger);
router.get('/ledger/export', exportFacilityLedger);

module.exports = router;
