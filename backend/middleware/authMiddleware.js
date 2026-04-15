/**
 * ============================================================
 * FILE: backend/middleware/authMiddleware.js
 * ROLE: JWT authentication & role-based authorization guards
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * Every protected route in requestRoutes.js and hospitalRoutes.js passes
 * through one or both of the functions exported here BEFORE the controller
 * function runs. The chain is:
 *
 *   HTTP Request → authMiddleware.protect → authMiddleware.authorize → controller
 *
 * HOW protect() WORKS
 * ────────────────────
 * 1. Reads the Authorization header from the incoming HTTP request.
 *    Expected format: "Bearer <jwt-token>"
 *
 * 2. Decodes the JWT using the shared JWT_SECRET from .env.
 *    The token payload is { id: <mongoUserId> } (set in authController.generateToken).
 *
 * 3. Fetches the full User document from MongoDB (minus the password hash)
 *    and attaches it to req.user.
 *
 * WHY re-fetch from DB instead of trusting the JWT payload?
 * ----------------------------------------------------------
 * The JWT only stores the user's _id. Sensitive fields like `role`, `name`,
 * and `bloodGroup` are read fresh from MongoDB each request. This prevents
 * stale data — e.g. if a user's role changes after they logged in, the next
 * request will pick up the new role immediately instead of relying on a
 * potentially outdated JWT claim.
 *
 * This also prevents the "Identity-Swap" bug: controllers (e.g. createRequest)
 * always read req.user from the DB, not from a JWT claim that could have been
 * forged or become stale.
 *
 * HOW authorize() WORKS
 * ─────────────────────
 * It is a factory middleware that takes a list of allowed roles as arguments:
 *   authorize('Hospital', 'Blood Bank')
 * and returns a middleware function that rejects any user whose req.user.role
 * is NOT in the list. This allows the route file to be self-documenting about
 * who can access each endpoint.
 *
 * Example from requestRoutes.js:
 *   router.get('/external', protect, authorize('Hospital', 'Blood Bank'), getExternalRequirements)
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * protect — verifies the Bearer JWT and attaches the DB user to req.user.
 *
 * Data in:  req.headers.authorization
 * Data out: req.user (full Mongoose document, password excluded via .select('-password'))
 */
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // No header or not Bearer format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  // Extract just the token after "Bearer "
  const token = authHeader.split(' ')[1];

  // Guard: token must exist and not be the string "undefined" or "null"
  // (These edge cases happen when the frontend sends a raw variable that
  // hasn't been set yet, e.g. localStorage.getItem('token') returned null.)
  if (!token || token === 'undefined' || token === 'null' || token === '') {
    return res.status(401).json({ message: 'Not authorized, invalid token' });
  }

  try {
    // Verify signature + expiry. Throws if tampered or expired.
    // decoded = { id: <mongoUserId>, iat: ..., exp: ... }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Re-fetch from DB. This ensures role/name/etc. are always current.
    // .select('-password') strips the hashed pw from the document.
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }

    // Attach the fresh DB document to req.user so every downstream
    // controller can trust req.user.name, req.user.role, etc.
    req.user = user;
    next();
  } catch (error) {
    console.error('JWT Error:', error.message);
    return res.status(401).json({ message: 'Not authorized, token expired or invalid' });
  }
};

/**
 * authorize(...roles) — role-based access control factory.
 *
 * Called AFTER protect (so req.user is already available).
 * Usage: authorize('Hospital', 'Blood Bank')
 *
 * Data in:  req.user.role (set by protect)
 * Data out: continues to next() or returns 403 Forbidden
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: `User role ${req.user.role} is not authorized` });
    }
    next();
  };
};

module.exports = { protect, authorize };
