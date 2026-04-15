/**
 * ============================================================
 * FILE: backend/routes/requestRoutes.js
 * ROLE: Express Router — maps /api/requests/* to requestController
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * Every request to /api/requests/* passes through this router.
 * All routes require the `protect` middleware (JWT verification).
 * Some routes additionally require `authorize` (role check).
 *
 * The full chain for each request:
 *   Client → protect → [authorize] → requestController function → res.json
 *
 * ENDPOINT GUIDE
 * ──────────────
 * POST / — Create a blood request  [User | Hospital | Blood Bank]
 *   Body: { bloodGroup, urgency, requestType, bloodUnits }
 *   1. Reads sender identity from DB (NOT JWT) to prevent identity-swap.
 *   2. Saves Request document with location from live socket session.
 *   3. Emits GLOBAL_EMERGENCY_DATA + INCOMING_EMERGENCY to nearby sockets.
 *   → createRequest()
 *
 * GET /me — My own requests
 *   Returns all requests where requester === req.user._id, sorted newest first.
 *   → getMyRequests()
 *
 * GET /incoming — Nearby pending requests (donor's view)  [User | Hospital | Blood Bank]
 *   1. Resolves the caller's blood group (from DB or MockSandboxRegistry).
 *   2. Filters pending requests by blood-group compatibility + 5 km radius.
 *   → getIncomingRequests()
 *
 * GET /external — Nearby pending requests (facility's view)  [Hospital | Blood Bank]
 *   Same as /incoming but uses 10 km radius and skips blood-group check
 *   (facilities can handle any blood group).
 *   → getExternalRequirements()
 *
 * PUT /:id/status — Update request lifecycle status
 *   Body: { status: 'Accepted' | 'Fulfilled' | ... }
 *   When status='Accepted': atomically sets status + acceptedBy using
 *   findOneAndUpdate to prevent race conditions.
 *   Emits 'request-accepted' to the requester's room.
 *   → updateRequestStatus()
 *
 * GET /:id/matches — Get sorted donor matches for a request  [Hospital | Blood Bank]
 *   Returns merged list of:
 *     - Internal donors (hospital's own walk-in database)
 *     - Platform users (registered donors within 5 km)
 *   Sorted by composite score from matchingAlgorithm.calculateScore().
 *   → getRequestMatches()
 *
 * PUT /:id/assign — Assign a donor to a fulfilled request  [Hospital | Blood Bank]
 *   Body: { assignedDonorId, phoneNumber? }
 *   Marks donor ineligible, sets request.status='Fulfilled',
 *   emits 'request-completed' to requester & 'REQUEST_FULFILLED' to donor.
 *   → assignDonor()
 */

const express = require('express');
const router = express.Router();
const { 
  createRequest, 
  getMyRequests, 
  getIncomingRequests, 
  getExternalRequirements, 
  updateRequestStatus, 
  getRequestMatches, 
  assignDonor 
} = require('../controllers/requestController');
const { protect, authorize } = require('../middleware/authMiddleware');

// All routes below require a valid JWT (the protect middleware runs first).
// authorize() additionally restricts to specific roles.

router.post('/', protect, authorize('User', 'Hospital', 'Blood Bank'), createRequest);
router.get('/me', protect, getMyRequests);
router.get('/incoming', protect, authorize('User', 'Hospital', 'Blood Bank'), getIncomingRequests);
router.get('/external', protect, authorize('Hospital', 'Blood Bank'), getExternalRequirements);
router.put('/:id/status', protect, updateRequestStatus);
router.get('/:id/matches', protect, authorize('Hospital', 'Blood Bank'), getRequestMatches);
router.put('/:id/assign', protect, authorize('Hospital', 'Blood Bank'), assignDonor);

module.exports = router;
