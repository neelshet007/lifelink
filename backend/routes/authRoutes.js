const express = require('express');
const router = express.Router();
const { registerUser, loginUser } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);

// Get current user profile based on auth token
router.get('/me', protect, (req, res) => {
  res.json(req.user);
});

module.exports = router;
