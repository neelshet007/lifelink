/**
 * ============================================================
 * FILE: backend/routes/authRoutes.js
 * ROLE: Express Router — maps /api/auth/* to authController functions
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * Every request to /api/auth/* passes through this file first.
 * The chain for each endpoint:
 *
 *   Client HTTP Request
 *     → Express CORS/Helmet/RateLimit (server.js)
 *     → [optional] validateRequestContext(schema) — validates req.body shape
 *     → [optional] protect — verifies JWT, attaches req.user
 *     → Controller function (authController.js)
 *     → res.json(...)
 *
 * ENDPOINT GUIDE
 * ──────────────
 * POST /register
 *   Public. Plain email + password registration.
 *   Body: { name, email, password, role, bloodGroup?, latitude?, longitude? }
 *   → authController.registerUser → User.create → returns JWT + serialized user
 *
 * POST /login
 *   Public. Email OR contact-number login.
 *   Body: { email, password }  (email field accepts mobile number too)
 *   → authController.loginUser → User.findOne → bcrypt.compare → returns JWT
 *
 * POST /gateway-login/initiate
 *   Public. First step of ABDM/HFR gateway login.
 *   Body: { identityType, identifier }
 *   Returns 'existing' (JWT) | 'provision_required' (redirect to sandbox UI)
 *   → authController.initiateGatewayLogin
 *
 * POST /gateway-login/complete
 *   Public. Second step — provisions the account if needed.
 *   → authController.completeGatewayLogin → User.create (if new) → returns JWT
 *
 * POST /mock-abdm/register  (alias: /mock-abdm/signup)
 *   Public. Creates a mock ABHA citizen profile in MockSandboxRegistry
 *   AND provisions a LifeLink User account in one call.
 *   → authController.registerMockAbha
 *
 * POST /mock-abdm/facility-onboarding
 *   Public. Registers a Hospital or Blood Bank in MockFacilitiesRegistry
 *   and provisions a LifeLink User account.
 *   → authController.registerFacilityOnboarding
 *
 * POST /complete-profile  [PROTECTED]
 *   For ABHA citizens to add their blood group after verifying at a facility.
 *   Body: { bloodGroup, verificationSourceId }
 *   → authController.completeTieredProfile → updates User + MockSandboxRegistry
 *
 * PATCH /location  [PROTECTED]
 *   Updates the user's stored GPS coordinates in MongoDB.
 *   Body: { latitude, longitude }
 *   → authController.updateCurrentLocation → User.save
 *
 * GET /me  [PROTECTED]
 *   Returns the current user document (attached by protect middleware).
 *   No controller needed — directly returns req.user.
 */

const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  initiateGatewayLogin,
  completeGatewayLogin,
  registerMockAbha,
  registerFacilityOnboarding,
  completeTieredProfile,
  updateCurrentLocation,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const {
  registerSchema,
  loginSchema,
  gatewayLoginSchema,
  mockAbhaRegisterSchema,
  completeProfileSchema,
  facilityOnboardingSchema,
  updateLocationSchema,
  validateRequestContext,
} = require('../validation/authValidation');

// ── Public routes (no JWT required) ──────────────────────────────────────────
router.post('/register', validateRequestContext(registerSchema), registerUser);
router.post('/login', validateRequestContext(loginSchema), loginUser);
router.post('/gateway-login/initiate', validateRequestContext(gatewayLoginSchema), initiateGatewayLogin);
router.post('/gateway-login/complete', validateRequestContext(gatewayLoginSchema), completeGatewayLogin);
router.post('/mock-abdm/register', validateRequestContext(mockAbhaRegisterSchema), registerMockAbha);
router.post('/mock-abdm/signup', validateRequestContext(mockAbhaRegisterSchema), registerMockAbha); // alias
router.post('/mock-abdm/facility-onboarding', validateRequestContext(facilityOnboardingSchema), registerFacilityOnboarding);

// ── Protected routes (JWT required) ──────────────────────────────────────────
// protect must appear BEFORE the controller so req.user is populated.
router.post('/complete-profile', protect, validateRequestContext(completeProfileSchema), completeTieredProfile);
router.patch('/location', protect, validateRequestContext(updateLocationSchema), updateCurrentLocation);

// Returns the authenticated user's own document — no separate controller needed.
router.get('/me', protect, (req, res) => {
  res.json(req.user); // req.user was attached by protect middleware
});

module.exports = router;
