/**
 * ============================================================
 * FILE: backend/socket/index.js
 * ROLE: Socket.IO server — real-time event hub for LifeLink
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * This file creates the Socket.IO server, manages the in-memory session
 * registry (activeSessions), and handles ALL real-time events between
 * the frontend and backend.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  BROADCAST FLOW (Emergency Created)                              │
 * │                                                                  │
 * │  Hospital/User emits REQUEST_BLOOD (socket)                      │
 * │    OR                                                            │
 * │  Hospital/User calls POST /api/requests (REST)                   │
 * │         ↓                                                        │
 * │  meshBroadcast() — scans activeSessions Map                      │
 * │         ↓                                                        │
 * │  GLOBAL_EMERGENCY_DATA   ─────────→  All nearby sessions         │
 * │  INCOMING_EMERGENCY      ─────────→  Nearby User sessions only   │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  RESPONSE FLOW (Donor/Facility Accepts)                          │
 * │                                                                  │
 * │  Donor emits DONOR_ACCEPTED_REQUEST                              │
 * │         ↓                                                        │
 * │  emitDonorAccepted() — reads DB, updates Request doc             │
 * │         ↓                                                        │
 * │  DONOR_ACCEPTED / REQUEST_CONFIRMED / EMERGENCY_ACCEPTED         │
 * │         ─────────→  Requester's personal socket room             │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * IDENTITY SAFETY IN THIS FILE
 * ----------------------------
 * All names that appear in outbound events are read from MongoDB,
 * NOT from the session object. The session is a convenience cache for
 * coordinates and role — it should never be treated as the source of
 * truth for the user's displayed name.
 *
 * PERSONAL ROOMS
 * --------------
 * When a session is initialized, the socket joins a room named after
 * the user's MongoDB _id (socket.join(user.id)). This allows the server
 * to send targeted events with io.to(userId).emit(...) without needing
 * to know the socketId.
 *
 * MESH RADII
 * ----------
 * User sessions:    5 km radius (donor walking distance)
 * Facility sessions: 10 km radius (transport range for blood supply)
 */

const { Server } = require('socket.io');
const User = require('../models/User');
const Request = require('../models/Request');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const { getDistance } = require('../utils/matchingAlgorithm');

// Broadcast radius constants (used in meshBroadcast and getNearbyRecipients)
const USER_RADIUS_KM = 5;
const FACILITY_RADIUS_KM = 10;

/**
 * resolveBloodGroup(user) → string
 *
 * Same logic as requestController.resolveUserBloodGroup.
 * ABHA users' blood group may be in MockSandboxRegistry (updated after
 * account creation via completeTieredProfile). We check there first.
 *
 * Data in: User document (Mongoose)
 * Data out: blood group string, e.g. 'O+' or ''
 */
async function resolveBloodGroup(user) {
  if (user?.abhaAddress) {
    const sandboxProfile = await MockSandboxRegistry.findOne({
      abhaAddress: user.abhaAddress.toLowerCase(),
    }).select('bloodGroup');
    if (sandboxProfile?.bloodGroup) return sandboxProfile.bloodGroup;
  }
  return user?.bloodGroup || '';
}

/**
 * setupSocket(server) → io
 *
 * Called once from server.js after MongoDB connects.
 * Returns the Socket.IO instance which is stored on the Express app
 * via app.set('io', io) so controllers can reach it with req.app.get('io').
 */
module.exports = function setupSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    // Ping settings: detect stale connections within ~30 seconds
    pingTimeout: 20000,   // close connection if no pong received in 20s
    pingInterval: 10000,  // send a ping every 10s
  });

  // ── Session registry ────────────────────────────────────────────────────────
  // activeSessions maps socketId → { userId, name, role, bloodGroup, latitude, longitude, ... }
  // This is an IN-MEMORY Map — it resets on server restart.
  // It is the source of truth for "who is online and where".
  const activeSessions = new Map();

  // ── Helper: upsertSession ─────────────────────────────────────────────────────
  /**
   * upsertSession(socket, payload) → session | null
   *
   * Creates or refreshes the session entry for a connected socket.
   * Called on:
   *   - 'join' event (legacy, just userId)
   *   - 'init_session' event (userId + optional GPS coords)
   *   - 'update_coords' event (re-sync GPS)
   *
   * Data flow:
   *   1. Extract userId from payload or socket.data (set on previous calls).
   *   2. Fetch fresh User doc from DB (name, role, location, identity IDs).
   *   3. If GPS coords provided, update user.location in MongoDB.
   *   4. Resolve blood group (may read MockSandboxRegistry for ABHA users).
   *   5. Join personal room (socket.join(user.id)) for targeted events.
   *   6. Join 'global-emergency' room for broadcast events.
   *   7. Store session in activeSessions Map.
   *   8. Emit 'session_ready' back to the client.
   *
   * Data in:  payload.userId, payload.latitude, payload.longitude
   * Data out: activeSessions Map updated, 'session_ready' event emitted
   */
  async function upsertSession(socket, payload = {}) {
    const userId = payload.userId || socket.data.userId;
    if (!userId) {
      socket.emit('session_error', { message: 'Missing userId for realtime session.' });
      return null;
    }

    // Always fetch fresh from DB — session.name is NOT the source of truth for identity
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

    // If fresh GPS was provided, persist it to MongoDB so the location
    // is still available after server restart or if this socket disconnects.
    if (hasCoords) {
      user.location = { type: 'Point', coordinates: [longitude, latitude] };
      user.isAvailable = true; // Always available — no cooldown for prototype
      await user.save();
    }

    // Resolve the user's actual blood group. For ABHA citizens this may differ
    // from user.bloodGroup if they updated it via completeTieredProfile.
    const bloodGroup = await resolveBloodGroup(user);

    // Join personal room — allows io.to(userId).emit(...) from controllers.
    // The room name is simply the MongoDB _id as a string.
    socket.join(user.id);
    // Join global emergency room — used for emergency-wide broadcasts
    socket.join('global-emergency');
    socket.data.userId = user.id; // persist userId on socket for future handlers

    const session = {
      socketId: socket.id,
      userId: user.id,
      name: user.name,   // convenience copy — do NOT use as identity source of truth
      role: user.role,
      bloodGroup,
      // Prefer fresh coordinates from payload; fall back to DB-stored location
      latitude: hasCoords ? latitude : user.location?.coordinates?.[1],
      longitude: hasCoords ? longitude : user.location?.coordinates?.[0],
      locationSyncedAt: new Date().toISOString(),
    };

    activeSessions.set(socket.id, session);
    socket.emit('session_ready', session); // client stores this in socketStore.session
    return session;
  }

  // ── Universal Mesh Broadcast ─────────────────────────────────────────────────
  /**
   * meshBroadcast(senderSocketId, payload) → notifiedSocketIds[]
   *
   * Scans ALL active sessions and emits GLOBAL_EMERGENCY_DATA to every
   * session that is within the appropriate radius.
   *
   * Blood-group compatibility check:
   *   - Facilities (Hospital/Blood Bank): always notified, no blood filtering
   *   - Users (donors): only notified if their blood group is compatible
   *
   * Called by:
   *   - 'REQUEST_BLOOD' socket event handler (socket-initiated emergency)
   *   - requestController.createRequest (REST-initiated emergency)
   *
   * senderName in the outbound payload is DB-sourced, NOT session.name.
   */
  async function meshBroadcast(senderSocketId, payload) {
    const sender = activeSessions.get(senderSocketId);
    if (!sender) return;

    const { latitude: sLat, longitude: sLng, userId: senderId } = sender;
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return;

    const { requestId, bloodGroup, urgency, requestType, bloodUnits, senderName, senderType } = payload;

    const notifiedSocketIds = [];

    for (const [socketId, session] of activeSessions.entries()) {
      if (session.userId === senderId) continue; // don't notify the sender themselves
      if (!Number.isFinite(session.latitude) || !Number.isFinite(session.longitude)) continue;

      const distanceKm = getDistance(sLat, sLng, session.latitude, session.longitude);

      // Apply radius based on recipient role
      const limit = session.role === 'User' ? USER_RADIUS_KM : FACILITY_RADIUS_KM;
      if (distanceKm > limit) continue;

      // Blood group matching: skip incompatible users (but always notify facilities)
      // O- requests skip this check because O- is the universal type and everyone
      // should know about it.
      if (session.role === 'User' && bloodGroup !== 'O-') {
        const bg = session.bloodGroup;
        if (!bg) continue; // skip users with no blood group registered
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
        // senderName comes from the DB-sourced field in payload, not session.name.
        // session.name is a convenience copy that could theoretically be stale.
        senderName: senderName || sender.name,
        senderType: senderType || sender.role,
        senderId,
        distanceKm: Number(distanceKm.toFixed(2)),
        distance: distanceKm.toFixed(1),
        senderCoords: { latitude: sLat, longitude: sLng }, // so recipient can open a map
      };

      // GLOBAL_EMERGENCY_DATA — received by GlobalMeshAlertPanel in all dashboards
      io.to(socketId).emit('GLOBAL_EMERGENCY_DATA', eventPayload);

      // INCOMING_EMERGENCY — legacy alias used by EmergencyActionDock (User role only)
      // This event sets socketStore.activeEmergency and triggers the bottom dock UI.
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

  // ── confirmRequest — Bi-directional acceptance acknowledgement ──────────────
  /**
   * confirmRequest(requestId, responder, overrides)
   *
   * Called when a FACILITY accepts a mesh alert via FACILITY_ACCEPTED_REQUEST event.
   *
   * Data flow:
   *   1. Find the Request document by ID.
   *   2. Read the acceptor's name from DB (NOT from the socket session).
   *   3. Write receiverName, receiverType, receiverId to the Request document.
   *   4. Emit REQUEST_CONFIRMED + NOTIFY_REQUESTER to the requester's room.
   *
   * WHY we write receiverName to the DB:
   *   - The requester needs to know who is coming without polling.
   *   - The UI shows "Accepted by [receiverName]" — this must be correct.
   *
   * WHY the payload is 'lean' (status-only):
   *   - We only send what changed: status, receiverName, receiverType.
   *   - We do NOT broadcast the acceptor's full user object to avoid
   *     the risk of the frontend merging it into the requester's display.
   */
  async function confirmRequest(requestId, responder, overrides = {}) {
    const request = await Request.findById(requestId);
    if (!request) return;

    // Read the acceptor's name from the DB — do NOT trust session.name
    const receiverDoc  = await User.findById(responder.userId).select('name role');
    const receiverName = receiverDoc?.name || overrides.responderName || responder.name || 'Unknown';
    const receiverType = receiverDoc?.role || overrides.responderRole || responder.role || 'Facility';

    // Persist the receiver identity to the Request document
    request.status       = 'Accepted';
    request.receiverName = receiverName;
    request.receiverType = receiverType;
    request.receiverId   = String(responder.userId);
    if (!request.handledBy) request.handledBy = responder.userId;
    await request.save();

    // Lean status payload — only what the requester needs to update their UI
    const statusPayload = {
      requestId:    request._id,
      status:       'Accepted',
      receiverName,
      receiverType,
      message:      `Request accepted by ${receiverName} (${receiverType})`,
    };

    // Emit to the requester's personal room (named after their userId)
    io.to(request.requester.toString()).emit('REQUEST_CONFIRMED', statusPayload);
    io.to(request.requester.toString()).emit('NOTIFY_REQUESTER',  statusPayload); // legacy alias
  }

  // ── emitDonorAccepted — Donor accepts a mesh alert ──────────────────────────
  /**
   * emitDonorAccepted(socket, payload)
   *
   * Called when a User (donor) accepts an incoming emergency.
   *
   * Data flow:
   *   1. Get the socket's session to read donorId + current GPS.
   *   2. Read the donor's name from DB (identity safety rule).
   *   3. Update Request: status='Accepted', receiverName=donorDoc.name.
   *   4. Calculate distance + ETA from donor's current location to request location.
   *   5. Emit multiple events to the requester's room (multi-alias for reliability).
   *
   * ETA formula: max(3, round(distanceKm × 4)) minutes
   *   Assumes ~15 km/h average speed (walking + public transit mix).
   *
   * Events emitted to requester:
   *   DONOR_ACCEPTED, EMERGENCY_ACCEPTED, DONOR_RESPONSE_RECEIVED,
   *   REQUEST_CONFIRMED, NOTIFY_REQUESTER
   *
   * (Multiple aliases because different frontend pages listen for different events.)
   */
  async function emitDonorAccepted(socket, payload = {}) {
    const session = activeSessions.get(socket.id);
    const donorId = payload?.donorId || session?.userId;
    if (!payload?.requestId || !donorId || !session) return;

    // Read the donor's name from the DB — do NOT use session.name which can
    // be stale or overwritten.
    const donorDoc = await User.findById(donorId).select('name bloodGroup');
    if (!donorDoc) return;

    // Atomically update the request: only accept if still Pending or Accepted
    const request = await Request.findOneAndUpdate(
      { _id: payload.requestId, status: { $in: ['Pending', 'Accepted'] } },
      {
        $set: {
          status:       'Accepted',
          receiverName: donorDoc.name,    // lock the acceptor name in DB (DB source of truth)
          receiverType: 'User',
          receiverId:   String(donorId),
        },
        $addToSet: { acceptedBy: donorId }, // add to accepted array (deduplication)
      },
      { new: true }
    ).populate('requester', 'name _id');

    if (!request) return;

    // Compute distance for ETA calculation
    const hospitalCoords = request.location?.coordinates || [0, 0];
    const donorLat = Number(session.latitude) || 0;
    const donorLng = Number(session.longitude) || 0;
    const distanceKm = getDistance(hospitalCoords[1] || 0, hospitalCoords[0] || 0, donorLat, donorLng);
    const etaMinutes = Math.max(3, Math.round(distanceKm * 4)); // minimum 3 min ETA

    // Lean payload: requestId, status, tracking fields only.
    // donorName is from the DB document — NOT from the socket session.
    const statusPayload = {
      requestId:    request._id,
      status:       'Accepted',
      donorId:      donorDoc._id,
      donorName:    donorDoc.name,         // DB source of truth
      bloodGroup:   donorDoc.bloodGroup,
      etaMinutes,
      distanceKm:   Number(distanceKm.toFixed(2)),
      coordinates:  { latitude: donorLat, longitude: donorLng }, // for hospital map
      receiverName: donorDoc.name,
      receiverType: 'User',
      message:      `Request accepted by ${donorDoc.name} (Donor)`,
    };

    const requesterRoomId = request.requester._id.toString();
    // Emit multiple event aliases for cross-page compatibility
    io.to(requesterRoomId).emit('DONOR_ACCEPTED',          statusPayload);
    io.to(requesterRoomId).emit('EMERGENCY_ACCEPTED',      statusPayload);
    io.to(requesterRoomId).emit('DONOR_RESPONSE_RECEIVED', { ...statusPayload, status: 'accepted' });
    io.to(requesterRoomId).emit('REQUEST_CONFIRMED',       statusPayload);
    io.to(requesterRoomId).emit('NOTIFY_REQUESTER',        statusPayload);
  }

  /**
   * emitDonorDeclined(socket, payload)
   *
   * Called when a donor declines an incoming emergency alert.
   * Does NOT update the Request status — the request remains Pending so
   * another donor can still respond.
   *
   * Emits DONOR_DECLINED + DONOR_RESPONSE_RECEIVED to the requester's room.
   */
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

  /**
   * emitLocationUpdate(socket, payload)
   *
   * Called when a donor (navigating to the hospital) sends a GPS update.
   * Keeps the activeSessions Map up-to-date with their latest position,
   * then recomputes ETA and emits LOCATION_UPDATE + DONOR_LIVE_LOCATION
   * to the original requester's room so the hospital can see the donor's
   * live position on their map.
   *
   * Data in: payload.coordinates.latitude/longitude OR payload.latitude/longitude
   * Data out: LOCATION_UPDATE + DONOR_LIVE_LOCATION → requester's room
   */
  async function emitLocationUpdate(socket, payload = {}) {
    const request = await Request.findById(payload?.requestId);
    if (!request) return;

    const session = activeSessions.get(socket.id);
    if (!session) return;

    // Normalize latitude/longitude from various payload shapes the client may send
    const latitude = Number(payload?.coordinates?.latitude ?? payload?.latitude);
    const longitude = Number(payload?.coordinates?.longitude ?? payload?.longitude);

    // Update the in-memory session with fresh coordinates
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

    // Emit to the requester (hospital) so their live map updates
    io.to(request.requester.toString()).emit('LOCATION_UPDATE', eventPayload);
    io.to(request.requester.toString()).emit('DONOR_LIVE_LOCATION', eventPayload); // alias
  }

  // ─── Exported helpers for controller access ──────────────────────────────────
  // These are attached to the `io` object so requestController.js can call
  // them directly via (req.app.get('io')).<method>().

  /** Returns the entire activeSessions Map for iteration in createRequest. */
  io.getActiveSessions = () => activeSessions;

  /** Looks up a session by userId (linear scan — fast enough for expected session counts). */
  io.getSessionByUserId = (userId) => {
    for (const session of activeSessions.values()) {
      if (String(session.userId) === String(userId)) return session;
    }
    return null;
  };

  /**
   * getNearbyRecipients — Legacy compat helper still used by requestController.
   * Returns an array of { socketId, userId, distanceKm, bloodGroup, role } for
   * sessions within the given radii, excluding the sender.
   */
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

  /** Alias: only return User-role sessions. */
  io.getNearbyEligibleRecipients = (args) => io.getNearbyRecipients({ ...args, targetRoles: ['User'] });

  // no-op stubs — request expiry was removed for the prototype
  io.trackNotifiedSockets = () => {};
  io.emitRequestExpired = () => {};

  // ─── Connection handler ───────────────────────────────────────────────────────
  io.on('connection', (socket) => {

    /**
     * 'join' — Legacy session init (only userId, no GPS)
     * Sent by older frontend pages that haven't switched to init_session yet.
     */
    socket.on('join', async (userId) => {
      if (!userId) return;
      await upsertSession(socket, { userId });
    });

    /**
     * 'init_session' — Full session init with optional GPS coordinates
     * Sent by LocationSyncProvider.jsx on every (re)connect.
     * payload: { userId, latitude?, longitude? }
     */
    socket.on('init_session', async (payload) => {
      try {
        await upsertSession(socket, payload);
      } catch (error) {
        console.error('[Socket] init_session error:', error);
        socket.emit('session_error', { message: 'Unable to initialize realtime session.' });
      }
    });

    /**
     * 'update_coords' — Refresh GPS coordinates in the session
     * Sent periodically by the frontend when location changes.
     * payload: { lat, lng }
     */
    socket.on('update_coords', async (payload) => {
      try {
        await upsertSession(socket, { userId: socket.data.userId, latitude: payload?.lat, longitude: payload?.lng });
      } catch (error) {
        console.error('[Socket] update_coords error:', error);
      }
    });

    /**
     * 'update_location' — Lightweight location update (no DB write)
     * Updates only the in-memory session. Used for frequent GPS ticks
     * where we don't want to hit MongoDB every 5 seconds.
     * payload: { latitude, longitude }
     */
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

    /**
     * 'REQUEST_BLOOD' — Universal emergency trigger for ANY entity
     * 
     * Any role (Hospital, Blood Bank, User) can emit this to broadcast
     * an emergency to the mesh.
     *
     * payload: { bloodGroup, urgency, requestType, bloodUnits, requestId? }
     *
     * If requestId is not provided, a new Request document is created in MongoDB
     * (so the emergency is persisted even if initiated via socket instead of REST).
     *
     * senderName is always read from the DB document — never from session.name.
     */
    socket.on('REQUEST_BLOOD', async (payload) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session) return;

        // Always fetch the sender's name from the DB — the session object
        // does not store the display name reliably; session.name can be undefined
        // or stale after a session swap.
        const senderDoc = await User.findById(session.userId)
          .select('name role hfrFacilityId dcgiLicenseNumber abhaAddress');
        if (!senderDoc) return;

        let requestId = payload.requestId;
        if (!requestId) {
          // No existing request — create one so the emergency is persisted in DB
          const lat = Number(session.latitude);
          const lng = Number(session.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const senderId =
              senderDoc.role === 'Hospital'   ? (senderDoc.hfrFacilityId    || 'SYSTEM') :
              senderDoc.role === 'Blood Bank' ? (senderDoc.dcgiLicenseNumber || 'SYSTEM') :
                                                (senderDoc.abhaAddress       || 'SYSTEM');

            const request = await Request.create({
              requester:  session.userId,
              senderName: senderDoc.name,          // ← DB-sourced, identity-safe
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

        // Mesh broadcast — uses DB-sourced senderName, not session.name
        await meshBroadcast(socket.id, {
          ...payload,
          requestId,
          senderName: senderDoc.name,  // override any client-provided name with DB truth
          senderType: senderDoc.role,
        });
        socket.emit('REQUEST_BLOOD_ACK', { requestId, message: 'Mesh broadcast sent.' });
      } catch (error) {
        console.error('[Socket] REQUEST_BLOOD error:', error);
      }
    });


    /**
     * 'FACILITY_ACCEPTED_REQUEST' — Hospital or Blood Bank responds to a mesh alert
     *
     * payload: { requestId, responderName?, responderRole? }
     *
     * Calls confirmRequest() which reads the acceptor's name from DB,
     * updates the Request document, and notifies the requester.
     */
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

    /**
     * 'DONOR_ACCEPTED_REQUEST' — User (donor) responds to a mesh alert
     *
     * payload: { requestId, donorId? }
     *
     * Calls emitDonorAccepted() which reads the donor's name from DB,
     * updates the Request document, and notifies the requester.
     */
    socket.on('DONOR_ACCEPTED_REQUEST', async (payload) => {
      try {
        await emitDonorAccepted(socket, { requestId: payload.requestId, donorId: payload.donorId });
      } catch (error) {
        console.error('[Socket] DONOR_ACCEPTED_REQUEST error:', error);
      }
    });

    // ── Legacy donor response events (kept for older frontend pages) ─────────────
    // These all call the same handlers as the primary events above.
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

    // Location updates from a donor who is navigating to the hospital
    socket.on('donor-location-update', async (payload) => {
      try { await emitLocationUpdate(socket, payload); } catch (e) { console.error(e); }
    });

    socket.on('LOCATION_UPDATE', async (payload) => {
      try { await emitLocationUpdate(socket, payload); } catch (e) { console.error(e); }
    });

    /**
     * 'ALLOCATE_FROM_STOCK' — Blood Bank allocates units from its inventory
     *
     * payload: { requestId, bloodBankId, bloodUnits, bloodGroup }
     *
     * Data flow:
     *   1. Find the Request and the Blood Bank's User document.
     *   2. Check if inventory has enough units. If not, emit ERROR to sender.
     *   3. Deduct units from bloodBank.inventory Map and save.
     *   4. Update request.status = 'Stock Confirmed'.
     *   5. Emit STOCK_CONFIRMED + REQUEST_CONFIRMED to the requester's room.
     *   6. Broadcast request-updated to all dashboards.
     */
    socket.on('ALLOCATE_FROM_STOCK', async (payload) => {
      try {
        const { requestId, bloodBankId, bloodUnits, bloodGroup } = payload;
        const request = await Request.findById(requestId).populate('requester', 'name');
        if (!request) return;

        const bloodBank = await User.findById(bloodBankId);
        if (!bloodBank) return;

        // Check current stock from the inventory Map (bloodGroup → unitCount)
        const currentStock = bloodBank.inventory.get(bloodGroup) || 0;
        if (currentStock < bloodUnits) {
          socket.emit('ERROR', { message: `Insufficient stock for ${bloodGroup}` });
          return;
        }

        // Deduct units and persist
        bloodBank.inventory.set(bloodGroup, currentStock - bloodUnits);
        await bloodBank.save();

        // Mark request as Stock Confirmed
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

        // Notify the requester their stock is on the way
        io.to(request.requester._id.toString()).emit('STOCK_CONFIRMED', eventPayload);
        io.to(request.requester._id.toString()).emit('REQUEST_CONFIRMED', {
          requestId: request._id,
          responderName: bloodBank.name,
          responderRole: 'Blood Bank',
          message: `Help is coming from ${bloodBank.name} (Blood Bank)`,
        });
        // Confirm to the blood bank that the allocation succeeded
        socket.emit('STOCK_ALLOCATED_SUCCESS', eventPayload);
        // Broadcast to all dashboards so they update the request status
        io.emit('request-updated', { requestId: request._id, status: 'Stock Confirmed' });
      } catch (error) {
        console.error('[Socket] ALLOCATE_FROM_STOCK error:', error);
      }
    });

    /**
     * 'disconnect' — Socket closed (tab closed, network loss, etc.)
     *
     * Remove the session from activeSessions so this user is no longer
     * considered "online" for mesh broadcasts or location tracking.
     *
     * The user's last known coordinates remain saved in MongoDB from the
     * most recent upsertSession call.
     */
    socket.on('disconnect', () => {
      activeSessions.delete(socket.id);
    });
  });

  return io; // returned to server.js which stores it on the Express app
};
