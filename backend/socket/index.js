const { Server } = require('socket.io');
const User = require('../models/User');
const Request = require('../models/Request');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const { getDistance, isBloodGroupCompatible } = require('../utils/matchingAlgorithm');

const requestNotifiedSockets = new Map();

async function resolveBloodGroup(user) {
  if (user?.abhaAddress) {
    const sandboxProfile = await MockSandboxRegistry.findOne({ abhaAddress: user.abhaAddress.toLowerCase() }).select('bloodGroup');
    if (sandboxProfile?.bloodGroup) return sandboxProfile.bloodGroup;
  }

  return user?.bloodGroup || '';
}

module.exports = function setupSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  const activeSessions = new Map();

  async function upsertSession(socket, payload = {}) {
    const userId = payload.userId || socket.data.userId;
    if (!userId) {
      socket.emit('session_error', { message: 'Missing userId for realtime session.' });
      return null;
    }

    const user = await User.findById(userId).select('name role location abhaAddress bloodGroup');
    if (!user) {
      socket.emit('session_error', { message: 'User not found for realtime session.' });
      return null;
    }

    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

    if (hasCoords) {
      user.location = { type: 'Point', coordinates: [longitude, latitude] };
      await user.save();
    }

    const bloodGroup = await resolveBloodGroup(user);

    socket.join(user.id);
    socket.data.userId = user.id;

    const session = {
      socketId: socket.id,
      userId: user.id,
      name: user.name,
      role: user.role,
      bloodGroup,
      latitude: hasCoords ? latitude : user.location?.coordinates?.[1],
      longitude: hasCoords ? longitude : user.location?.coordinates?.[0],
      locationSyncedAt: new Date().toISOString(),
    };

    activeSessions.set(socket.id, session);
    socket.emit('session_ready', session);
    return session;
  }

  io.getActiveSessions = () => activeSessions;

  io.getSessionByUserId = (userId) => {
    for (const session of activeSessions.values()) {
      if (String(session.userId) === String(userId)) {
        return session;
      }
    }
    return null;
  };

  io.getNearbyEligibleRecipients = ({ latitude, longitude, bloodGroup, radiusKm = 5, excludeUserId }) => {
    const recipients = [];

    for (const [socketId, session] of activeSessions.entries()) {
      if (String(session.userId) === String(excludeUserId)) continue;
      if (session.role !== 'User') continue;
      if (!isBloodGroupCompatible(session.bloodGroup, bloodGroup)) continue;
      if (!Number.isFinite(session.latitude) || !Number.isFinite(session.longitude)) continue;

      const distanceKm = getDistance(latitude, longitude, session.latitude, session.longitude);
      if (distanceKm <= radiusKm) {
        recipients.push({
          socketId,
          userId: session.userId,
          distanceKm,
          bloodGroup: session.bloodGroup,
        });
      }
    }

    return recipients.sort((a, b) => a.distanceKm - b.distanceKm);
  };

  io.trackNotifiedSockets = (requestId, socketIds) => {
    requestNotifiedSockets.set(String(requestId), new Set(socketIds));
  };

  io.emitRequestExpired = (requestId, expiresAt) => {
    const notified = requestNotifiedSockets.get(String(requestId));
    if (!notified) return;

    for (const socketId of notified) {
      io.to(socketId).emit('REQUEST_EXPIRED', { requestId, expiresAt });
    }

    requestNotifiedSockets.delete(String(requestId));
  };

  io.on('connection', (socket) => {
    socket.on('join', async (userId) => {
      if (!userId) return;
      await upsertSession(socket, { userId });
    });

    socket.on('init_session', async (payload) => {
      try {
        await upsertSession(socket, payload);
      } catch (error) {
        console.error('[Socket] init_session error:', error);
        socket.emit('session_error', { message: 'Unable to initialize realtime session.' });
      }
    });

    socket.on('update_coords', async (payload) => {
      try {
        await upsertSession(socket, {
          userId: socket.data.userId,
          latitude: payload?.lat,
          longitude: payload?.lng,
        });
      } catch (error) {
        console.error('[Socket] update_coords error:', error);
      }
    });

    socket.on('update_location', async (payload) => {
      try {
        await upsertSession(socket, {
          userId: socket.data.userId,
          latitude: payload?.latitude,
          longitude: payload?.longitude,
        });
      } catch (error) {
        console.error('[Socket] update_location error:', error);
      }
    });

    socket.on('accept_request', async (payload) => {
      try {
        const request = await Request.findById(payload?.requestId).populate('requester', 'name');
        if (!request) return;

        const session = activeSessions.get(socket.id);
        const donor = session?.userId ? await User.findById(session.userId).select('name bloodGroup') : null;
        if (!session?.userId || !donor) return;

        const hospitalCoords = request.location?.coordinates || [0, 0];
        const donorLat = Number(session.latitude) || 0;
        const donorLng = Number(session.longitude) || 0;
        const distanceKm = getDistance(hospitalCoords[1] || 0, hospitalCoords[0] || 0, donorLat, donorLng);
        const etaMinutes = Math.max(3, Math.round(distanceKm * 4));

        io.to(request.requester._id.toString()).emit('EMERGENCY_ACCEPTED', {
          requestId: request._id,
          donorId: donor._id,
          donorName: donor.name,
          bloodGroup: session.bloodGroup || donor.bloodGroup,
          etaMinutes,
          distanceKm: Number(distanceKm.toFixed(2)),
          coordinates: {
            latitude: donorLat,
            longitude: donorLng,
          },
        });
      } catch (error) {
        console.error('[Socket] accept_request error:', error);
      }
    });

    socket.on('decline_request', async (payload) => {
      try {
        const request = await Request.findById(payload?.requestId);
        if (!request) return;

        const session = activeSessions.get(socket.id);
        io.to(request.requester.toString()).emit('EMERGENCY_DECLINED', {
          requestId: request._id,
          donorId: session?.userId || null,
          donorName: session?.name || 'Unknown donor',
        });
      } catch (error) {
        console.error('[Socket] decline_request error:', error);
      }
    });

    socket.on('donor-location-update', async (payload) => {
      try {
        const request = await Request.findById(payload?.requestId);
        if (!request) return;

        io.to(request.requester.toString()).emit('DONOR_LIVE_LOCATION', payload);
      } catch (error) {
        console.error('[Socket] donor-location-update error:', error);
      }
    });

    socket.on('disconnect', () => {
      activeSessions.delete(socket.id);
    });
  });

  return io;
};
