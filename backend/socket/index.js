const { Server } = require('socket.io');
const User = require('../models/User');
const Request = require('../models/Request');
const { getDistance } = require('../utils/matchingAlgorithm');

// Track which socketIds were notified per requestId so we can send targeted expiry events
const requestNotifiedSockets = new Map(); // requestId -> Set<socketId>

module.exports = function (server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    // Ensure reliable reconnection from clients
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  const activeSockets = new Map();

  // ─── Helper: join a socket to its user room and populate activeSockets ────────
  async function joinUser(socket, userId) {
    socket.join(userId);
    socket.data.userId = userId;

    try {
      const user = await User.findById(userId).select('name role bloodGroup location');
      const existing = activeSockets.get(socket.id) || {};
      activeSockets.set(socket.id, {
        ...existing,
        userId,
        name: user?.name || '',
        role: user?.role || '',
        bloodGroup: user?.bloodGroup || '',
        longitude: existing.longitude ?? user?.location?.coordinates?.[0],
        latitude: existing.latitude ?? user?.location?.coordinates?.[1],
      });
      console.log(
        `[Socket] ${new Date().toISOString()} User ${userId} (${user?.role || 'unknown'}) joined room.`
      );
    } catch {
      activeSockets.set(socket.id, { userId });
      console.log(`[Socket] ${new Date().toISOString()} User ${userId} joined (DB lookup failed).`);
    }
  }

  // ─── Public API exposed to the request controller ─────────────────────────────
  io.getNearbyEligibleRecipients = ({ latitude, longitude, bloodGroup, radiusKm = 5, excludeUserId }) => {
    const recipients = [];

    for (const [socketId, meta] of activeSockets.entries()) {
      // Skip non-donors or the requester themselves
      if (!meta.userId || String(meta.userId) === String(excludeUserId)) continue;
      if (meta.role !== 'User' || !meta.bloodGroup) continue;

      // Blood group compatibility: exact match OR donor is universal (O-)
      // OR requested group is AB+ (universal recipient)
      const compatible =
        meta.bloodGroup === bloodGroup ||
        meta.bloodGroup === 'O-' ||
        bloodGroup === 'AB+';
      if (!compatible) continue;

      // Must have real GPS coords
      if (typeof meta.latitude !== 'number' || typeof meta.longitude !== 'number') {
        console.log(`[Socket] Skipping ${meta.userId} — no GPS coords in activeSockets.`);
        continue;
      }

      const distance = getDistance(latitude, longitude, meta.latitude, meta.longitude);
      if (distance <= radiusKm) {
        recipients.push({ socketId, userId: meta.userId, distance });
      }
    }

    console.log(
      `[Socket] ${new Date().toISOString()} getNearbyEligibleRecipients → ${recipients.length} eligible donor(s) within ${radiusKm}km for blood group ${bloodGroup}.`
    );

    return recipients;
  };

  // ─── Expose emit helper for controller-triggered expiry events ────────────────
  io.emitRequestExpired = (requestId, expiresAt) => {
    const notified = requestNotifiedSockets.get(String(requestId));
    if (!notified || notified.size === 0) return;

    console.log(
      `[Socket] ${new Date().toISOString()} Emitting REQUEST_EXPIRED to ${notified.size} socket(s) for request ${requestId}.`
    );

    for (const socketId of notified) {
      io.to(socketId).emit('REQUEST_EXPIRED', { requestId, expiresAt });
    }

    requestNotifiedSockets.delete(String(requestId));
  };

  // ─── Allow controller to register which sockets were notified ─────────────────
  io.trackNotifiedSockets = (requestId, socketIds) => {
    requestNotifiedSockets.set(String(requestId), new Set(socketIds));
  };

  // ─── Expose active socket map for debugging ───────────────────────────────────
  io.getActiveSockets = () => activeSockets;

  // ─── Connection handler ───────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[Socket] ${new Date().toISOString()} Connected: ${socket.id}`);

    // Primary room join — sent immediately after login
    socket.on('join', async (userId) => {
      if (!userId) return;
      await joinUser(socket, userId);
    });

    // Role-based room (e.g. 'facility-command')
    socket.on('join-role', (roomName) => {
      socket.join(roomName);
      console.log(`[Socket] ${socket.id} joined role room: ${roomName}`);
    });

    // Region-based room (e.g. 'south-zone')
    socket.on('join-region', (regionRoom) => {
      socket.join(regionRoom);
      console.log(`[Socket] ${socket.id} joined region room: ${regionRoom}`);
    });

    // Live coordinate update from navigator.geolocation (format: {lat, lng, bloodGroup?})
    socket.on('update_coords', (payload) => {
      const current = activeSockets.get(socket.id) || { userId: socket.data.userId };
      activeSockets.set(socket.id, {
        ...current,
        latitude: payload?.lat,
        longitude: payload?.lng,
        ...(payload?.bloodGroup ? { bloodGroup: payload.bloodGroup } : {}),
      });
    });

    // Alternate format for backward compat ({latitude, longitude, bloodGroup?})
    socket.on('update_location', (payload) => {
      const current = activeSockets.get(socket.id) || { userId: socket.data.userId };
      activeSockets.set(socket.id, {
        ...current,
        latitude: payload?.latitude,
        longitude: payload?.longitude,
        ...(payload?.bloodGroup ? { bloodGroup: payload.bloodGroup } : {}),
      });
    });

    // ── Donor accepts emergency — inform hospital ──────────────────────────────
    socket.on('accept_request', async (payload) => {
      try {
        const request = await Request.findById(payload?.requestId).populate('requester', 'name');
        if (!request) {
          console.error(`[Socket] accept_request: Request ${payload?.requestId} not found.`);
          return;
        }

        // Resolve donor userId robustly: socket.data first, then activeSockets fallback
        let donorUserId = socket.data.userId;
        const meta = activeSockets.get(socket.id);
        if (!donorUserId) {
          donorUserId = meta?.userId;
        }

        if (!donorUserId) {
          console.error(`[Socket] accept_request: Cannot identify donor for socket ${socket.id}.`);
          return;
        }

        const donor = await User.findById(donorUserId).select('name bloodGroup');
        if (!donor) {
          console.error(`[Socket] accept_request: Donor ${donorUserId} not found in DB.`);
          return;
        }

        // Live socket coordinates: meta stores {latitude, longitude} already in degrees
        const hasLiveCoords =
          typeof meta?.latitude === 'number' && typeof meta?.longitude === 'number';
        const donorLat = hasLiveCoords ? meta.latitude : 0;
        const donorLng = hasLiveCoords ? meta.longitude : 0;

        const hospitalCoords = request.location?.coordinates || [0, 0];
        // hospitalCoords is GeoJSON [lng, lat]
        const distance = getDistance(
          hospitalCoords[1] || 0,  // hospital lat
          hospitalCoords[0] || 0,  // hospital lng
          donorLat,
          donorLng
        );
        const etaMinutes = Math.max(3, Math.round(distance * 4));

        const hospitalRoomId = request.requester._id
          ? request.requester._id.toString()
          : request.requester.toString();

        console.log(
          `[Socket] ${new Date().toISOString()} EMERGENCY_ACCEPTED → hospital room ${hospitalRoomId}. Donor: ${donor.name}, ETA: ${etaMinutes}m. Coords: ${hasLiveCoords ? `live(${donorLat},${donorLng})` : 'no GPS'}.`
        );

        io.to(hospitalRoomId).emit('EMERGENCY_ACCEPTED', {
          requestId: request._id,
          donorId: donor._id,
          donorName: donor.name,
          bloodGroup: meta?.bloodGroup || donor.bloodGroup,
          etaMinutes,
          coordinates: {
            latitude: donorLat,
            longitude: donorLng,
          },
        });
      } catch (error) {
        console.error('[Socket] accept_request error:', error);
      }
    });

    // ── Donor declines emergency — inform hospital ─────────────────────────────
    socket.on('decline_request', async (payload) => {
      try {
        const request = await Request.findById(payload?.requestId);
        if (!request) return;

        let donorUserId = socket.data.userId || activeSockets.get(socket.id)?.userId;
        const donor = donorUserId ? await User.findById(donorUserId).select('name') : null;

        const hospitalRoomId = request.requester.toString();
        io.to(hospitalRoomId).emit('EMERGENCY_DECLINED', {
          requestId: request._id,
          donorId: donorUserId || null,
          donorName: donor?.name || 'Unknown donor',
        });

        console.log(
          `[Socket] ${new Date().toISOString()} EMERGENCY_DECLINED → hospital room ${hospitalRoomId}.`
        );
      } catch (error) {
        console.error('[Socket] decline_request error:', error);
      }
    });

    // ── Donor live location stream → hospital ──────────────────────────────────
    socket.on('donor-location-update', async (payload) => {
      try {
        const request = await Request.findById(payload?.requestId);
        if (request?.requester) {
          io.to(request.requester.toString()).emit('DONOR_LIVE_LOCATION', payload);
        }
      } catch (error) {
        console.error('[Socket] donor-location-update error:', error);
      }
    });

    // ── Cleanup on disconnect ─────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      activeSockets.delete(socket.id);
      console.log(`[Socket] ${new Date().toISOString()} Disconnected: ${socket.id} (reason: ${reason})`);
    });
  });

  return io;
};
