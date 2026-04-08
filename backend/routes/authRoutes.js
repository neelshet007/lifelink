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

router.post('/register', validateRequestContext(registerSchema), registerUser);
router.post('/login', validateRequestContext(loginSchema), loginUser);
router.post('/gateway-login/initiate', validateRequestContext(gatewayLoginSchema), initiateGatewayLogin);
router.post('/gateway-login/complete', validateRequestContext(gatewayLoginSchema), completeGatewayLogin);
router.post('/mock-abdm/register', validateRequestContext(mockAbhaRegisterSchema), registerMockAbha);
router.post('/mock-abdm/signup', validateRequestContext(mockAbhaRegisterSchema), registerMockAbha);
router.post('/mock-abdm/facility-onboarding', validateRequestContext(facilityOnboardingSchema), registerFacilityOnboarding);
router.post('/complete-profile', protect, validateRequestContext(completeProfileSchema), completeTieredProfile);
router.patch('/location', protect, validateRequestContext(updateLocationSchema), updateCurrentLocation);

router.get('/me', protect, (req, res) => {
  res.json(req.user);
});

module.exports = router;
