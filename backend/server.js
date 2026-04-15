/**
 * ============================================================
 * FILE: backend/server.js
 * ROLE: Application Entry Point & HTTP + WebSocket Bootstrap
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * 1. This file creates the Express HTTP server and attaches every
 *    global middleware (CORS, Helmet, Rate-Limit, JSON parsing).
 *
 * 2. It registers three REST route groups:
 *      /api/auth      → authRoutes.js   → authController.js
 *      /api/requests  → requestRoutes.js → requestController.js
 *      /api/hospital  → hospitalRoutes.js → hospitalController.js
 *
 * 3. After MongoDB connects, it calls setupSocket() which creates
 *    the Socket.IO server and attaches it to the same HTTP server.
 *    The returned `io` instance is stored on the Express app via
 *    app.set('io', io) so that controllers can retrieve it with
 *    req.app.get('io') and emit real-time events without importing
 *    socket/index.js directly.
 *
 * WHY THIS ORDER MATTERS
 * ----------------------
 * - CORS must be registered BEFORE Helmet because browser preflight
 *   (OPTIONS) requests arrive before any security header checks.
 *   Reversing the order would cause all cross-origin requests to fail.
 *
 * - The socket server is started INSIDE the mongoose.connect().then()
 *   callback to guarantee the DB is ready before any socket handler
 *   tries to query it (e.g. upsertSession → User.findById).
 *
 * - The rate limiter (200 req / 15 min) runs AFTER CORS/Helmet so
 *   the headers are already set before the IP counter increments.
 */

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const setupSocket = require('./socket/index');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorMiddleware');

const app = express();

// http.createServer wraps Express so the same TCP server can handle
// both REST (HTTP) and real-time (WebSocket / Socket.IO) connections.
const server = http.createServer(app);

// ✅ CORS must come BEFORE helmet so browser preflight requests are handled first
app.use(cors({
  origin: [
    'http://localhost:3000',
    process.env.FRONTEND_URL || 'http://localhost:3000'
  ],
  credentials: true,           // allows cookies/auth headers cross-origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));



// Security Middleware (after CORS)
// crossOriginResourcePolicy: 'cross-origin' lets the frontend (port 3000)
// load assets served by the backend (port 5000) without being blocked.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' } // allow assets cross-origin
}));

// Rate limiter: prevents abuse / brute-force.
// Limit is raised to 200 to avoid throttling during active development.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // raised to avoid dev throttling
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use(limiter);

// Parse incoming JSON bodies so controllers can access req.body.
app.use(express.json());

// ── Route Registration ────────────────────────────────────────────────────────
// Each group is mounted under a unique prefix.
// The middleware chain for a typical protected request is:
//   Express router → validateRequestContext() → protect() → controller function
const authRoutes = require('./routes/authRoutes');
const requestRoutes = require('./routes/requestRoutes');
const hospitalRoutes = require('./routes/hospitalRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/hospital', hospitalRoutes);

// Simple health-check endpoint used by uptime monitors / Docker health-checks.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Centralized Error Handler — must be LAST middleware.
// It catches anything passed via next(err) from controllers.
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/lifelink';

// Connect to MongoDB first, then start listening.
// This prevents socket handlers from querying the DB before it is ready.
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    
    // setupSocket() creates the Socket.IO server, registers all event
    // handlers, and returns the io instance.
    // We store it on the Express app so controllers can call
    //   const io = req.app.get('io');
    // and emit targeted events to specific users or rooms.
    const io = setupSocket(server);
    app.set('io', io);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));
