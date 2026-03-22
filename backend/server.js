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
const server = http.createServer(app);

// ✅ CORS must come BEFORE helmet so browser preflight requests are handled first
app.use(cors({
  origin: [
    'http://localhost:3000',
    process.env.FRONTEND_URL || 'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));



// Security Middleware (after CORS)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' } // allow assets cross-origin
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // raised to avoid dev throttling
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use(limiter);

app.use(express.json());

// Routes
const authRoutes = require('./routes/authRoutes');
const requestRoutes = require('./routes/requestRoutes');
const hospitalRoutes = require('./routes/hospitalRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/hospital', hospitalRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Centralized Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/lifelink';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    
    const io = setupSocket(server);
    app.set('io', io);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));
