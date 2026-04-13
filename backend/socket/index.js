const { Server } = require('socket.io');
const User = require('../models/User');
const Request = require('../models/Request');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const { getDistance } = require('../utils/matchingAlgorithm');

// ── Mesh broadcast radii ────────────────────────────────────────────────────────
const USER_RADIUS_KM = 5;
const FACILITY_RADIUS_KM = 10;

async function resolveBloodGroup(user) {
  if (user?.abhaAddress) {
    const sandboxProfile = await MockSandboxRegistry.findOne({
      abhaAddress: user.abhaAddress.toLowerCase(),
    }).select('bloodGroup');
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

  // ── Session registry ────────────────────────────────────────────────────────
  // { socketId → session }
  const activeSessions = new Map();

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function upsertSession(socket, payload = {}) {
    const userId = payload.userId || socket.data.userId;
    if (!userId) {
      socket.emit('session_error', { message: 'Missing userId for realtime session.' });
      return null;
    }

    const user = await User.findById(userId).select(
      'name role location abhaAddress bloodGroup hfrFacilityId dcgiLicenseNumber'
    );
    if (!user) {
      socket.emit('session_error', { message: 'User not found for realtime session.' });
      return null;
    }

    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

    if (hasCoords) {
      user.location = { type: 'Point', coordinates: [longitude, latitude] };
      // Always available — no cooldown for prototype
      user.isAvailable = true;
      await user.save();
    }

    const bloodGroup = await resolveBloodGroup(user);

    // Join personal room (for targeted events)
    socket.join(user.id);
    // Join global emergency room
    socket.join('global-emergency');
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

  // ── Universal Mesh Broadcast ─────────────────────────────────────────────────
  // Scans ALL active sessions, applies Haversine + blood group matching,
  // and emits GLOBAL_EMERGENCY_DATA to every qualifying socket.
  async function meshBroadcast(senderSocketId, payload) {
    const sender = activeSessions.get(senderSocketId);
    if (!sender) return;

    const { latitude: sLat, longitude: sLng, userId: senderId } = sender;
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return;

    const { requestId, bloodGroup, urgency, requestType, bloodUnits, senderName, senderType } = payload;

    const notifiedSocketIds = [];

    for (const [socketId, session] of activeSessions.entries()) {
      if (session.userId === senderId) continue; // skip sender
      if (!Number.isFinite(session.latitude) || !Number.isFinite(session.longitude)) continue;

      const distanceKm = getDistance(sLat, sLng, session.latitude, session.longitude);

      // Radius: facilities get 10km range, users get 5km
      const limit = session.role === 'User' ? USER_RADIUS_KM : FACILITY_RADIUS_KM;
      if (distanceKm > limit) continue;

      // Blood group matching: skip incompatible users (but always notify facilities)
      if (session.role === 'User' && bloodGroup !== 'O-') {
        const bg = session.bloodGroup;
        if (!bg) continue;
        // Basic compatibility: exact match, or receiver is universal (AB+/AB-)
        const compatible = bg === bloodGroup || bg === 'AB+' || bg === 'AB-' || bloodGroup === 'O-';
        if (!compatible) continue;
      }

      const eventPayload = {
        requestId,
        bloodGroup,
        bloodUnits: bloodUnits || 1,
        urgency: urgency || 'Standard',
        requestType: requestType || 'Blood Request',
        senderName: senderName || sender.name,
        senderType: senderType || sender.role,
        senderId,
        distanceKm: Number(distanceKm.toFixed(2)),
        distance: distanceKm.toFixed(1),
        senderCoords: { latitude: sLat, longitude: sLng },
      };

      io.to(socketId).emit('GLOBAL_EMERGENCY_DATA', eventPayload);

      // Legacy compat: users also receive INCOMING_EMERGENCY for the ActionDock
      if (session.role === 'User') {
        io.to(socketId).emit('INCOMING_EMERGENCY', {
          ...eventPayload,
          hospital:       senderName || sender.name,
          hospitalType:   senderType || sender.role,
          hospitalCoords: { latitude: sLat, longitude: sLng },
          message: `${senderType || sender.role} (${senderName || sender.name}) needs ${bloodGroup} — ${distanceKm.toFixed(1)} km away`,
        });
      }

      notifiedSocketIds.push(socketId);
    }

    return notifiedSocketIds;
  }

  // ── Request Confirmed (bi-directional ack) ──────────────────────────────────
  // Accepts a request, writes receiverName/receiverType to the DB,
  // then emits a MINIMAL status-update payload to the original requester's room.
  // We do NOT broadcast the acceptor's full user object anywhere.
  async function confirmRequest(requestId, responder, overrides = {}) {
    const request = await Request.findById(requestId);
    if (!request) return;

    // Read the acceptor's name from the DB to be the source of truth
    const receiverDoc  = await User.findById(responder.userId).select('name role');
    const receiverName = receiverDoc?.name || overrides.responderName || responder.name || 'Unknown';
    const receiverType = receiverDoc?.role || overrides.responderRole || responder.role || 'Facility';

    // Write receiver identity into the DB — stored on the request document,
    // never merged into sender fields.
    request.status       = 'Accepted';
    request.receiverName = receiverName;
    request.receiverType = receiverType;
    request.receiverId   = String(responder.userId);
    if (!request.handledBy) request.handledBy = responder.userId;
    await request.save();

    // Emit a lean status-only event to the requester's personal room.
    // The frontend updates ONLY the status field of the matching request.
    const statusPayload = {
      requestId:    request._id,
      status:       'Accepted',
      receiverName,
      receiverType,
      message:      `Request accepted by ${receiverName} (${receiverType})`,
    };

    io.to(request.requester.toString()).emit('REQUEST_CONFIRMED', statusPayload);
    io.to(request.requester.toString()).emit('NOTIFY_REQUESTER',  statusPayload);
  }

  // ── Donor accepted flow ─────────────────────────────────────────────────────
  async function emitDonorAccepted(socket, payload = {}) {
    const session = activeSessions.get(socket.id);
    const donorId = payload?.donorId || session?.userId;
    if (!payload?.requestId || !donorId || !session) return;

    // Read the donor's name from the DB — do NOT use session.name which can
    // be stale or overwritten.
    const donorDoc = await User.findById(donorId).select('name bloodGroup');
    if (!donorDoc) return;

    const request = await Request.findOneAndUpdate(
      { _id: payload.requestId, status: { $in: ['Pending', 'Accepted'] } },
      {
        $set: {
          status:       'Accepted',
          receiverName: donorDoc.name,    // lock the acceptor name in DB
          receiverType: 'User',
          receiverId:   String(donorId),
        },
        $addToSet: { acceptedBy: donorId },
      },
      { new: true }
    ).populate('requester', 'name _id');

    if (!request) return;

    const hospitalCoords = request.location?.coordinates || [0, 0];
    const donorLat = Number(session.latitude) || 0;
    const donorLng = Number(session.longitude) || 0;
    const distanceKm = getDistance(hospitalCoords[1] || 0, hospitalCoords[0] || 0, donorLat, donorLng);
    const etaMinutes = Math.max(3, Math.round(distanceKm * 4));

    // Lean payload: requestId, status, and tracking-specific fields only.
    // donorName is from the DB document — NOT from the socket session.
    const statusPayload = {
      requestId:    request._id,
      status:       'Accepted',
      donorId:      donorDoc._id,
      donorName:    donorDoc.name,         // DB source of truth
      bloodGroup:   donorDoc.bloodGroup,
      etaMinutes,
      distanceKm:   Number(distanceKm.toFixed(2)),
      coordinates:  { latitude: donorLat, longitude: donorLng },
      receiverName: donorDoc.name,
      receiverType: 'User',
      message:      `Request accepted by ${donorDoc.name} (Donor)`,
    };

    const requesterRoomId = request.requester._id.toString();
    io.to(requesterRoomId).emit('DONOR_ACCEPTED',          statusPayload);
    io.to(requesterRoomId).emit('EMERGENCY_ACCEPTED',      statusPayload);
    io.to(requesterRoomId).emit('DONOR_RESPONSE_RECEIVED', { ...statusPayload, status: 'accepted' });
    io.to(requesterRoomId).emit('REQUEST_CONFIRMED',       statusPayload);
    io.to(requesterRoomId).emit('NOTIFY_REQUESTER',        statusPayload);
  }

  async function emitDonorDeclined(socket, payload = {}) {
    const request = await Request.findById(payload?.requestId);
    if (!request) return;

    const session = activeSessions.get(socket.id);
    const eventPayload = {
      requestId: request._id,
      donorId: payload?.donorId || session?.userId || null,
      donorName: session?.name || 'Unknown donor',
    };

    io.to(request.requester.toString()).emit('DONOR_DECLINED', eventPayload);
    io.to(request.requester.toString()).emit('EMERGENCY_DECLINED', eventPayload);
    io.to(request.requester.toString()).emit('DONOR_RESPONSE_RECEIVED', { ...eventPayload, status: 'declined' });
  }

  async function emitLocationUpdate(socket, payload = {}) {
    const request = await Request.findById(payload?.requestId);
    if (!request) return;

    const session = activeSessions.get(socket.id);
    if (!session) return;

    const latitude = Number(payload?.coordinates?.latitude ?? payload?.latitude);
    const longitude = Number(payload?.coordinates?.longitude ?? payload?.longitude);

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      activeSessions.set(socket.id, { ...session, latitude, longitude, locationSyncedAt: new Date().toISOString() });
    }

    const nextSession = activeSessions.get(socket.id);
    const donorLat = Number(nextSession.latitude) || 0;
    const donorLng = Number(nextSession.longitude) || 0;
    const hospitalCoords = request.location?.coordinates || [0, 0];
    const distanceKm = getDistance(hospitalCoords[1] || 0, hospitalCoords[0] || 0, donorLat, donorLng);
    const etaMinutes = Math.max(3, Math.round(distanceKm * 4));

    const eventPayload = {
      requestId: request._id,
      donorId: payload?.donorId || nextSession.userId,
      donorName: nextSession.name,
      coordinates: { latitude: donorLat, longitude: donorLng },
      distanceKm: Number(distanceKm.toFixed(2)),
      etaMinutes,
    };

    io.to(request.requester.toString()).emit('LOCATION_UPDATE', eventPayload);
    io.to(request.requester.toString()).emit('DONOR_LIVE_LOCATION', eventPayload);
  }

  // ─── Exported helpers for controller access ──────────────────────────────────
  io.getActiveSessions = () => activeSessions;

  io.getSessionByUserId = (userId) => {
    for (const session of activeSessions.values()) {
      if (String(session.userId) === String(userId)) return session;
    }
    return null;
  };

  // Legacy compat — still used by requestController
  io.getNearbyRecipients = ({ latitude, longitude, bloodGroup, radiusKmUser = 5, radiusKmFacility = 10, excludeUserId, targetRoles = ['User'] }) => {
    const recipients = [];
    for (const [socketId, session] of activeSessions.entries()) {
      if (String(session.userId) === String(excludeUserId)) continue;
      if (!targetRoles.includes(session.role)) continue;
      if (!Number.isFinite(session.latitude) || !Number.isFinite(session.longitude)) continue;

      const distanceKm = getDistance(latitude, longitude, session.latitude, session.longitude);
      const limit = session.role === 'User' ? radiusKmUser : radiusKmFacility;
      if (distanceKm <= limit) {
        recipients.push({ socketId, userId: session.userId, distanceKm, bloodGroup: session.bloodGroup, role: session.role });
      }
    }
    return recipients.sort((a, b) => a.distanceKm - b.distanceKm);
  };

  io.getNearbyEligibleRecipients = (args) => io.getNearbyRecipients({ ...args, targetRoles: ['User'] });

  io.trackNotifiedSockets = () => {}; // no-op — mesh has no expiry
  io.emitRequestExpired = () => {};   // no-op — removed for prototype

  // ─── Connection handler ───────────────────────────────────────────────────────
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
        await upsertSession(socket, { userId: socket.data.userId, latitude: payload?.lat, longitude: payload?.lng });
      } catch (error) {
        console.error('[Socket] update_coords error:', error);
      }
    });

    socket.on('update_location', async (payload) => {
      try {
        const session = activeSessions.get(socket.id);
        if (session && Number.isFinite(Number(payload?.latitude)) && Number.isFinite(Number(payload?.longitude))) {
          activeSessions.set(socket.id, { ...session, latitude: Number(payload.latitude), longitude: Number(payload.longitude), locationSyncedAt: new Date().toISOString() });
        }
      } catch (error) {
        console.error('[Socket] update_location error:', error);
      }
    });

    // ── Universal Trigger: Any entity emits this to broadcast to the mesh ────────
    socket.on('REQUEST_BLOOD', async (payload) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session) return;

        // Always fetch the sender's name from the DB — the session object
        // does not store the display name, so we cannot rely on session.name.
        const senderDoc = await User.findById(session.userId)
          .select('name role hfrFacilityId dcgiLicenseNumber abhaAddress');
        if (!senderDoc) return;

        let requestId = payload.requestId;
        if (!requestId) {
          const lat = Number(session.latitude);
          const lng = Number(session.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const senderId =
              senderDoc.role === 'Hospital'   ? (senderDoc.hfrFacilityId    || 'SYSTEM') :
              senderDoc.role === 'Blood Bank' ? (senderDoc.dcgiLicenseNumber || 'SYSTEM') :
                                                (senderDoc.abhaAddress       || 'SYSTEM');

            const request = await Request.create({
              requester:  session.userId,
              senderName: senderDoc.name,          // ← DB-sourced, required field
              senderType: senderDoc.role,
              senderId,
              bloodGroup:  payload.bloodGroup  || 'O+',
              bloodUnits:  payload.bloodUnits  || 1,
              urgency:     payload.urgency     || 'Critical',
              requestType: payload.requestType || 'Blood Request',
              location: { type: 'Point', coordinates: [lng, lat] },
              status: 'Pending',
            });
            requestId = request._id;
          }
        }

        // Broadcast uses the DB-sourced name, not session.name which is undefined
        await meshBroadcast(socket.id, {
          ...payload,
          requestId,
          senderName: senderDoc.name,
          senderType: senderDoc.role,
        });
        socket.emit('REQUEST_BLOOD_ACK', { requestId, message: 'Mesh broadcast sent.' });
      } catch (error) {
        console.error('[Socket] REQUEST_BLOOD error:', error);
      }
    });


    // ── Facility accepted: Hospital/Blood Bank responds to a mesh alert ──────────
    socket.on('FACILITY_ACCEPTED_REQUEST', async (payload) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session) return;
        // Pass payload overrides so the displayed name matches exactly what the
        // client sent (avoids using an empty session.name if the session hasn't
        // been properly initialised yet)
        await confirmRequest(payload.requestId, session, {
          responderName: payload.responderName || session.name,
          responderRole: payload.responderRole || session.role,
        });
        socket.emit('FACILITY_ACCEPTED_ACK', { requestId: payload.requestId });
      } catch (error) {
        console.error('[Socket] FACILITY_ACCEPTED_REQUEST error:', error);
      }
    });

    // ── Donor accepted: User responds to a mesh alert ───────────────────────────
    socket.on('DONOR_ACCEPTED_REQUEST', async (payload) => {
      try {
        await emitDonorAccepted(socket, { requestId: payload.requestId, donorId: payload.donorId });
      } catch (error) {
        console.error('[Socket] DONOR_ACCEPTED_REQUEST error:', error);
      }
    });

    // ── Legacy donor response events ─────────────────────────────────────────────
    socket.on('accept_request', async (payload) => {
      try { await emitDonorAccepted(socket, payload); } catch (e) { console.error(e); }
    });

    socket.on('DONOR_ACCEPTED', async (payload) => {
      try { await emitDonorAccepted(socket, payload); } catch (e) { console.error(e); }
    });

    socket.on('decline_request', async (payload) => {
      try { await emitDonorDeclined(socket, payload); } catch (e) { console.error(e); }
    });

    socket.on('DONOR_DECLINED', async (payload) => {
      try { await emitDonorDeclined(socket, payload); } catch (e) { console.error(e); }
    });

    socket.on('donor-location-update', async (payload) => {
      try { await emitLocationUpdate(socket, payload); } catch (e) { console.error(e); }
    });

    socket.on('LOCATION_UPDATE', async (payload) => {
      try { await emitLocationUpdate(socket, payload); } catch (e) { console.error(e); }
    });

    // ── Stock Allocation (Blood Bank → Hospital/User) ──────────────────────────
    socket.on('ALLOCATE_FROM_STOCK', async (payload) => {
      try {
        const { requestId, bloodBankId, bloodUnits, bloodGroup } = payload;
        const request = await Request.findById(requestId).populate('requester', 'name');
        if (!request) return;

        const bloodBank = await User.findById(bloodBankId);
        if (!bloodBank) return;

        const currentStock = bloodBank.inventory.get(bloodGroup) || 0;
        if (currentStock < bloodUnits) {
          socket.emit('ERROR', { message: `Insufficient stock for ${bloodGroup}` });
          return;
        }

        bloodBank.inventory.set(bloodGroup, currentStock - bloodUnits);
        await bloodBank.save();

        request.status = 'Stock Confirmed';
        request.handledBy = bloodBankId;
        await request.save();

        const eventPayload = {
          requestId: request._id,
          facilityId: bloodBank._id,
          facilityName: bloodBank.name,
          bloodGroup,
          bloodUnits,
          status: 'Reserved',
          message: `Blood units reserved by ${bloodBank.name}. In Transit.`,
        };

        io.to(request.requester._id.toString()).emit('STOCK_CONFIRMED', eventPayload);
        io.to(request.requester._id.toString()).emit('REQUEST_CONFIRMED', {
          requestId: request._id,
          responderName: bloodBank.name,
          responderRole: 'Blood Bank',
          message: `Help is coming from ${bloodBank.name} (Blood Bank)`,
        });
        socket.emit('STOCK_ALLOCATED_SUCCESS', eventPayload);
        io.emit('request-updated', { requestId: request._id, status: 'Stock Confirmed' });
      } catch (error) {
        console.error('[Socket] ALLOCATE_FROM_STOCK error:', error);
      }
    });

    socket.on('disconnect', () => {
      activeSessions.delete(socket.id);
    });
  });

  return io;
};
