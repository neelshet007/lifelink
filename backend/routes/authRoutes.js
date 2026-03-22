const express = require('express');
const router = express.Router();
const { registerUser, loginUser } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { registerSchema, loginSchema, validateRequestContext } = require('../validation/authValidation');

router.post('/register', validateRequestContext(registerSchema), registerUser);
router.post('/login', validateRequestContext(loginSchema), loginUser);

// Get current user profile based on auth token
router.get('/me', protect, (req, res) => {
  res.json(req.user);
});

module.exports = router;
