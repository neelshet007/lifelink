const { Server } = require('socket.io');
const User = require('../models/User');
const { getDistance } = require('../utils/matchingAlgorithm');

module.exports = function(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST']
    }
  });

  const connectedUsers = new Map();

  io.getNearbyEligibleRecipients = ({ latitude, longitude, bloodGroup, radiusKm = 5, excludeUserId }) => {
    const recipients = [];

    for (const [socketId, meta] of connectedUsers.entries()) {
      if (!meta.userId || String(meta.userId) === String(excludeUserId)) {
        continue;
      }

      if (meta.role !== 'User' || !meta.bloodGroup) {
        continue;
      }

      const compatible = meta.bloodGroup === bloodGroup || meta.bloodGroup === 'O-';
      if (!compatible) {
        continue;
      }

      if (typeof meta.latitude !== 'number' || typeof meta.longitude !== 'number') {
        continue;
      }

      const distance = getDistance(latitude, longitude, meta.latitude, meta.longitude);
      if (distance <= radiusKm) {
        recipients.push({
          socketId,
          userId: meta.userId,
          distance,
        });
      }
    }

    return recipients;
  };

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join', async (userId) => {
      socket.join(userId);
      socket.data.userId = userId;

      try {
        const user = await User.findById(userId).select('role bloodGroup location');
        connectedUsers.set(socket.id, {
          userId,
          role: user?.role || '',
          bloodGroup: user?.bloodGroup || '',
          longitude: user?.location?.coordinates?.[0],
          latitude: user?.location?.coordinates?.[1],
        });
      } catch {
        connectedUsers.set(socket.id, { userId });
      }

      console.log(`User ${userId} joined their notification room`);
    });

    socket.on('join-role', (roomName) => {
      socket.join(roomName);
      console.log(`Socket ${socket.id} joined role room ${roomName}`);
    });

    socket.on('join-region', (regionRoom) => {
      socket.join(regionRoom);
      console.log(`Socket ${socket.id} joined region room ${regionRoom}`);
    });

    socket.on('update_location', (payload) => {
      const current = connectedUsers.get(socket.id) || { userId: socket.data.userId };
      connectedUsers.set(socket.id, {
        ...current,
        latitude: payload?.latitude,
        longitude: payload?.longitude,
        ...(payload?.bloodGroup ? { bloodGroup: payload.bloodGroup } : {}),
      });
    });

    socket.on('donor-location-update', (payload) => {
      const regionRoom = payload?.currentRegion || 'south-zone';
      io.to('facility-command').emit('donor-live-location', payload);
      io.to(regionRoom).emit('donor-live-location', payload);
      console.log(`Donor live location forwarded to facility-command and ${regionRoom}`);
    });

    socket.on('disconnect', () => {
      connectedUsers.delete(socket.id);
      console.log(`User disconnected: ${socket.id}`);
    });
  });

  return io;
};
