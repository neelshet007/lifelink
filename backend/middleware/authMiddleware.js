const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // No header or not Bearer format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  const token = authHeader.split(' ')[1];

  // Guard: token must exist and not be the string "undefined" or "null"
  if (!token || token === 'undefined' || token === 'null' || token === '') {
    return res.status(401).json({ message: 'Not authorized, invalid token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('JWT Error:', error.message);
    return res.status(401).json({ message: 'Not authorized, token expired or invalid' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: `User role ${req.user.role} is not authorized` });
    }
    next();
  };
};

module.exports = { protect, authorize };
