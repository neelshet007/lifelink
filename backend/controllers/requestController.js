/**
 * ============================================================
 * FILE: backend/controllers/requestController.js
 * ROLE: All business logic for blood/supply request lifecycle
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * This controller handles the core LifeLink emergency workflow:
 *   Create → Notify → Match → Accept → Assign → Fulfill
 *
 * Key data sources consumed here:
 *   - req.user      → from authMiddleware.protect (MongoDB User document)
 *   - req.body      → from the client's HTTP request
 *   - req.app.get('io') → Socket.IO instance registered in server.js
 *   - User model    → MongoDB User collection
 *   - Request model → MongoDB Request collection
 *
 * IDENTITY SAFETY RULE (applied throughout)
 * -----------------------------------------
 * The sender's name (senderName) is ALWAYS read from the MongoDB User
 * document, never from:
 *   - The JWT payload (could be stale)
 *   - The socket session (can be uninitialized or swapped)
 *   - req.body (user-supplied, untrustworthy)
 *
 * This rule was introduced to fix the "Identity-Swap" bug where the
 * acceptor's name was overwriting the requester's name in the UI.
 */

const mongoose = require('mongoose');
const Request = require('../models/Request');
const User = require('../models/User');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const { getDistance, calculateScore, isBloodGroupCompatible } = require('../utils/matchingAlgorithm');

// ── Prototype mode: all eligibility/cooldown checks are bypassed ─────────────
// In a real system, checkEligibility would enforce the 90-day cooldown.
// For now it always returns true so demos work with any donor.
const getCompatibility = (donorBloodGroup, requestedBloodGroup) => {
  if (!donorBloodGroup) return 'Not compatible';
  if (donorBloodGroup === requestedBloodGroup) return 'Exact';
  return isBloodGroupCompatible(donorBloodGroup, requestedBloodGroup) ? 'Compatible' : 'Not compatible';
};

const checkEligibility = () => true; // bypassed for prototype

/**
 * resolveUserBloodGroup(user)
 *
 * Blood group source priority:
 *   1. MockSandboxRegistry (ABHA users who updated their bloodGroup via
 *      completeTieredProfile) — this is the freshest source for ABHA citizens.
 *   2. user.bloodGroup from the User document (LOCAL / HFR / DCGI users).
 *
 * We check the sandbox registry FIRST because ABHA users' blood groups
 * may have been updated through the ABDM portal after their LifeLink
 * User document was created.
 */
const resolveUserBloodGroup = async (user) => {
  if (user?.abhaAddress) {
    const sandboxProfile = await MockSandboxRegistry.findOne({ abhaAddress: user.abhaAddress.toLowerCase() }).select('bloodGroup');
    if (sandboxProfile?.bloodGroup) return sandboxProfile.bloodGroup;
  }

  return user?.bloodGroup || '';
};

/**
 * createRequest — POST /api/requests
 *
 * Data in:
 *   req.body  → { bloodGroup, urgency, requestType, bloodUnits }
 *   req.user  → MongoDB User doc (from authMiddleware.protect)
 *   socket session → live GPS coordinates (latitude/longitude)
 *
 * Data flow:
 *   1. Load the requester's DB document (source of truth for identity).
 *   2. Read live GPS from the socket session (more accurate than DB location).
 *      Falls back to DB location if no active session exists.
 *   3. Create the Request document with senderName frozen from DB.
 *   4. Iterate active socket sessions and emit mesh alerts to everyone
 *      within 5 km (users) or 10 km (facilities).
 *   5. Return the saved request + notified count.
 *
 * Data out:
 *   HTTP 201 → { request: <RequestDoc>, meta: { notifiedCount, coords } }
 *   Socket   → GLOBAL_EMERGENCY_DATA + INCOMING_EMERGENCY (to nearby sessions)
 */
const createRequest = async (req, res) => {
  try {
    const { bloodGroup, urgency, requestType, bloodUnits } = req.body;

    // ── Step 1: Resolve the sender from the database (source of truth) ──────────
    // We read the name directly from the DB document, NOT from the JWT or socket
    // session, to prevent the identity-swap bug.
    const requesterDoc = await User.findById(req.user._id).select('name role location hfrFacilityId dcgiLicenseNumber abhaAddress');
    if (!requesterDoc) {
      return res.status(404).json({ message: 'Requesting user not found.' });
    }

    // Retrieve the Socket.IO instance stored on the Express app in server.js.
    // io.getSessionByUserId() is a custom helper added in socket/index.js that
    // scans the in-memory activeSessions Map for a matching userId.
    const io = req.app.get('io');
    const activeSession = io?.getSessionByUserId?.(req.user._id);

    // Prefer live GPS from the socket session; fall back to stored DB coordinates.
    // GeoJSON stores coordinates as [lng, lat], so index [0]=lng, [1]=lat.
    const latitude  = Number(activeSession?.latitude  ?? requesterDoc.location?.coordinates?.[1]);
    const longitude = Number(activeSession?.longitude ?? requesterDoc.location?.coordinates?.[0]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: 'Live coordinates are required before creating a request.' });
    }

    // Build the senderId — the human-readable government identity token.
    // Used for display only; does not affect logic.
    const senderId =
      requesterDoc.role === 'Hospital'   ? requesterDoc.hfrFacilityId    :
      requesterDoc.role === 'Blood Bank' ? requesterDoc.dcgiLicenseNumber :
                                           requesterDoc.abhaAddress;

    // ── Step 2: Save to MongoDB with senderName locked as a static String ────────
    // senderName is NEVER populated from a socket session or JWT claim —
    // only from the DB document loaded above. It will not change for the
    // lifetime of this request document.
    const request = await Request.create({
      requester:  requesterDoc._id,
      senderName: requesterDoc.name,          // static — frozen at creation
      senderType: requesterDoc.role,
      senderId:   senderId || 'SYSTEM',
      bloodGroup,
      bloodUnits: bloodUnits || 1,
      urgency:    urgency || 'Standard',
      requestType: requestType || 'Blood Request',
      location: {
        type: 'Point',
        coordinates: [longitude, latitude], // GeoJSON convention: [lon, lat]
      },
      status: 'Pending',
    });

    // ── Step 3: Signal the mesh via socket (DB save already complete) ─────────────
    // Only send the minimal safe payload. We do NOT include the requester's full
    // user object — only identifiers and the frozen senderName from the DB record.
    if (io) {
      // activeSessions is the in-memory Map of { socketId → session } in socket/index.js.
      const activeSessions = io.getActiveSessions?.();
      if (activeSessions) {
        const { getDistance: gd } = require('../utils/matchingAlgorithm');
        const USER_RADIUS     = 5;   // km — how far donors are notified
        const FACILITY_RADIUS = 10;  // km — how far hospitals/blood banks are notified
        let notified = 0;

        for (const [, session] of activeSessions.entries()) {
          // Don't notify the requester themselves
          if (String(session.userId) === String(requesterDoc._id)) continue;
          // Skip sessions without valid coordinates
          if (!Number.isFinite(session.latitude) || !Number.isFinite(session.longitude)) continue;

          const dist  = gd(latitude, longitude, session.latitude, session.longitude);
          const limit = session.role === 'User' ? USER_RADIUS : FACILITY_RADIUS;
          if (dist > limit) continue;

          // Minimal mesh payload — only what the recipient needs to render the alert.
          // senderName comes from the DB record, not from the session or JWT.
          const meshPayload = {
            requestId:   request._id,
            senderName:  request.senderName,   // ← DB-frozen value (identity-safe)
            senderType:  request.senderType,
            bloodGroup:  request.bloodGroup,
            bloodUnits:  request.bloodUnits,
            urgency:     request.urgency,
            requestType: request.requestType,
            distanceKm:  Number(dist.toFixed(2)),
            distance:    dist.toFixed(1),
            senderCoords: { latitude, longitude }, // so recipients can open a map
          };

          // GLOBAL_EMERGENCY_DATA → received by ALL roles (User, Hospital, Blood Bank)
          // Stored in socketStore.meshAlerts[] on the frontend.
          io.to(session.socketId).emit('GLOBAL_EMERGENCY_DATA', meshPayload);

          // INCOMING_EMERGENCY → additional legacy event for the User EmergencyActionDock
          // Sets socketStore.activeEmergency and triggers the bottom dock UI.
          if (session.role === 'User') {
            io.to(session.socketId).emit('INCOMING_EMERGENCY', {
              ...meshPayload,
              hospital:      request.senderName,
              hospitalType:  request.senderType,
              hospitalCoords: { latitude, longitude },
              message: `${request.senderType} (${request.senderName}) needs ${bloodGroup} — ${dist.toFixed(1)} km away`,
            });
          }

          notified++;
        }

        // Persist the notified count so dashboards can show "X people alerted"
        request.notifiedDonorCount = notified;
        await request.save();
      }
    }

    return res.status(201).json({
      request,
      meta: {
        notifiedCount: request.notifiedDonorCount,
        coords: { latitude, longitude },
      },
    });
  } catch (error) {
    console.error('createRequest error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * getMyRequests — GET /api/requests/me
 *
 * Data in: req.user._id (from authMiddleware)
 * Data out: Array of Request documents where requester === current user.
 *
 * Sorted newest-first so the dashboard always shows the most recent request.
 * handledBy is populated (joined) so the UI can show who handled the request.
 */
const getMyRequests = async (req, res) => {
  try {
    const requests = await Request.find({ requester: req.user._id }).populate('handledBy', 'name').sort({ createdAt: -1 });
    return res.json(requests);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * getIncomingRequests — GET /api/requests/incoming
 *
 * Data in: req.user._id (from authMiddleware)
 * Data out: Nearby pending requests compatible with the caller's blood group.
 *
 * Used by DONOR dashboard to list requests they can respond to.
 *
 * Data flow:
 *   1. Load caller's location + blood group from DB.
 *   2. Resolve actual blood group via resolveUserBloodGroup (checks ABHA sandbox first).
 *   3. Fetch all 'Pending' requests from DB.
 *   4. In-memory filter: keep requests within 5 km AND blood-group compatible.
 *
 * WHY in-memory instead of $geoNear?
 * We also need to check blood-group compatibility at the same time, which is
 * logic that can't be expressed as a simple MongoDB query. Filtering 
 * in-memory on "all pending" is fast enough for the current dataset size.
 */
const getIncomingRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('location bloodGroup abhaAddress');
    const donorBloodGroup = await resolveUserBloodGroup(user);
    const latitude = user?.location?.coordinates?.[1];
    const longitude = user?.location?.coordinates?.[0];

    const requests = await Request
      .find({ status: 'Pending' })
      .populate('requester', 'name email location')
      .sort({ createdAt: -1 });

    // Filter in-memory: keep requests within 5 km + blood compatible
    const nearbyRequests = requests.filter((request) => {
      const requestLatitude = request.location?.coordinates?.[1];
      const requestLongitude = request.location?.coordinates?.[0];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      if (!Number.isFinite(requestLatitude) || !Number.isFinite(requestLongitude)) return false;
      // isBloodGroupCompatible from matchingAlgorithm.js handles all donor→patient rules
      if (!isBloodGroupCompatible(donorBloodGroup, request.bloodGroup)) return false;
      return getDistance(latitude, longitude, requestLatitude, requestLongitude) <= 5;
    });

    return res.json(nearbyRequests);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * getExternalRequirements — GET /api/requests/external
 *
 * Data in: req.user (Hospital or Blood Bank role enforced by router)
 * Data out: Nearby pending/stock-confirmed requests from other facilities.
 *
 * Used by HOSPITAL / BLOOD BANK dashboards to see what other facilities need.
 * Radius is 10 km (double the donor radius) because facilities can transport
 * blood further than a walking donor.
 *
 * The $ne filter excludes the caller's own requests (a hospital shouldn't
 * respond to its own alerts).
 */
const getExternalRequirements = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('location role');
    if (user.role !== 'Blood Bank' && user.role !== 'Hospital') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const latitude = user?.location?.coordinates?.[1];
    const longitude = user?.location?.coordinates?.[0];

    // Find all pending requests (not created by self)
    const requests = await Request
      .find({ 
        status: { $in: ['Pending', 'Stock Confirmed'] },
        requester: { $ne: req.user._id } // exclude own requests
      })
      .populate('requester', 'name role')
      .sort({ createdAt: -1 });

    const filtered = requests.filter((request) => {
      const requestLatitude = request.location?.coordinates?.[1];
      const requestLongitude = request.location?.coordinates?.[0];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      if (!Number.isFinite(requestLatitude) || !Number.isFinite(requestLongitude)) return false;
      
      const distance = getDistance(latitude, longitude, requestLatitude, requestLongitude);
      // Facilities see requests within 10km
      return distance <= 10;
    });

    return res.json(filtered);
  } catch (error) {
    console.error('getExternalRequirements error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * updateRequestStatus — PUT /api/requests/:id/status
 *
 * Data in:
 *   req.params.id → Request _id from URL
 *   req.body.status → new status string
 *   req.user → authenticated user
 *
 * Data flow (Accepted path — most complex):
 *   1. findOneAndUpdate with atomic filter: { _id, status: 'Pending' }
 *      If another user already accepted, this returns null (race-condition safe).
 *   2. Sets handledBy only if the actor is a facility (not a individual donor).
 *   3. Emits 'request-accepted' targeted to the requester's personal socket room.
 *   4. Broadcasts 'request-updated' to ALL connected sockets so dashboards refresh.
 *
 * For non-Accepted statuses (Closed, Expired, etc.):
 *   Simple findById → status update → save (no concurrency concern).
 *
 * WHY atomic update for 'Accepted'?
 * Multiple donors may click Accept simultaneously. findOneAndUpdate with
 * { status: 'Pending' } as filter ensures only ONE update succeeds. All
 * others get null and return 409 Conflict — preventing double-acceptance.
 */
const updateRequestStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user._id;
    const userName = req.user.name;

    if (status === 'Accepted') {
      // Atomic update: transition from Pending → Accepted exactly once
      const updated = await Request.findOneAndUpdate(
        { _id: req.params.id, status: 'Pending' }, // condition ensures atomicity
        {
          $set: { status: 'Accepted', handledBy: (req.user.role === 'Hospital' || req.user.role === 'Blood Bank') ? userId : undefined },
          $addToSet: { acceptedBy: userId }, // push to array only if not already present
        },
        { new: true } // return the updated document
      );

      if (!updated) {
        // Check if the request even exists (to differentiate 404 vs 409)
        const exists = await Request.findById(req.params.id);
        if (!exists) return res.status(404).json({ message: 'Request not found' });
        return res.status(409).json({ message: 'Request already accepted by another responder.' });
      }

      const io = req.app.get('io');
      if (io) {
        // Targeted notification: emit ONLY to the requester's personal room
        // (socket room named after their userId, joined in upsertSession).
        io.to(updated.requester.toString()).emit('request-accepted', {
          requestId: updated._id,
          message: `Your request has been accepted by ${userName}`,
        });
        // Broadcast to all so every dashboard refreshes the request status
        io.emit('request-updated', { requestId: updated._id, status: 'Accepted' });
      }

      return res.json(updated);
    }

    // For non-Accepted status transitions (e.g. Closed, Expired):
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    request.status = status;
    const saved = await request.save();
    return res.json(saved);
  } catch (error) {
    console.error('updateRequestStatus error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * getRequestMatches — GET /api/requests/:id/matches
 *
 * Data in: req.params.id (Request _id), req.user (hospital/blood bank)
 * Data out: Sorted array of compatible donor candidates.
 *
 * Searches TWO pools:
 *   1. Hospital's own internalDonorDatabase (walk-in / offline donors stored
 *      in the hospital's User document as sub-documents).
 *   2. Platform Users with role='User' within 5 km of the request location.
 *
 * Both pools are scored using matchingAlgorithm.calculateScore():
 *   Score = 0.4 * distance + 0.3 * blood compatibility + 0.2 * availability + 0.1 * eligibility
 *
 * The merged list is sorted descending by score so the best match appears first.
 */
const getRequestMatches = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    // Load the hospital document to access its internalDonorDatabase
    const hospital = await User.findById(req.user._id);

    // ── Pool 1: Internal donors (hospital's offline walk-in database) ─────────
    const internalMatches = hospital.internalDonorDatabase
      .filter((donor) => {
        const compat = getCompatibility(donor.bloodGroup, request.bloodGroup);
        return compat !== 'Not compatible' && donor.isAvailable !== false && checkEligibility(donor.lastDonationDate) && donor.is_eligible !== false;
      })
      .map((donor) => {
        const compat = getCompatibility(donor.bloodGroup, request.bloodGroup);
        // Calculate days since last donation for the eligibility score component
        const lastDonationDaysAgo = donor.lastDonationDate
          ? Math.floor((Date.now() - new Date(donor.lastDonationDate).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          _id: donor._id,
          name: donor.name,
          age: donor.age,
          type: 'Internal', // tag so the frontend can show the source
          bloodGroup: donor.bloodGroup,
          contact: donor.contact,
          barcodeId: donor.barcodeId,
          donationHistory: donor.donationHistory,
          score: calculateScore(0, compat, true, lastDonationDaysAgo), // distance=0 (already at hospital)
        };
      });

    // ── Pool 2: Platform users (registered donors on the platform) ─────────────
    // Fetch all registered donor accounts except the original requester.
    const allUsers = await User.find({ role: 'User', _id: { $ne: request.requester } });
    const platformMatches = allUsers
      .filter((user) => {
        const compat = getCompatibility(user.bloodGroup, request.bloodGroup);
        if (compat === 'Not compatible') return false;
        if (user.isAvailable === false || user.is_eligible === false || !checkEligibility(user.lastDonationDate)) return false;
        const userLat = user.location?.coordinates?.[1];
        const userLng = user.location?.coordinates?.[0];
        const requestLat = request.location?.coordinates?.[1];
        const requestLng = request.location?.coordinates?.[0];
        // Only keep donors within 5 km of the request
        return Number.isFinite(userLat) && Number.isFinite(userLng) && getDistance(requestLat, requestLng, userLat, userLng) <= 5;
      })
      .map((user) => {
        const distance = getDistance(
          request.location.coordinates[1],
          request.location.coordinates[0],
          user.location.coordinates[1],
          user.location.coordinates[0]
        );
        const compat = getCompatibility(user.bloodGroup, request.bloodGroup);
        const lastDonationDaysAgo = user.lastDonationDate
          ? Math.floor((Date.now() - new Date(user.lastDonationDate).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          _id: user._id,
          name: user.name,
          type: 'Platform', // tag for the frontend
          bloodGroup: user.bloodGroup,
          score: calculateScore(distance, compat, true, lastDonationDaysAgo),
          contact: user.contact,
          age: user.age,
          distance: Number(distance.toFixed(2)),
        };
      });

    // Merge both pools and sort by score (highest match first)
    return res.json([...internalMatches, ...platformMatches].sort((a, b) => b.score - a.score));
  } catch (error) {
    console.error('getRequestMatches error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * assignDonor — PUT /api/requests/:id/assign
 *
 * Data in:
 *   req.params.id    → Request _id
 *   req.body         → { assignedDonorId, phoneNumber? }
 *   req.user         → hospital/blood bank making the assignment
 *
 * Resolution order for the donor:
 *   1. Check hospital's internalDonorDatabase by barcodeId OR contact number.
 *   2. If not found, check platform Users by ObjectId (assignedDonorId).
 *
 * Data flow after finding the donor:
 *   1. Mark donor ineligible (is_eligible=false, lastDonationDate=now).
 *   2. Update request: status='Fulfilled', assignedDonorId, handledBy.
 *   3. Emit 'request-completed' to the original requester.
 *   4. Emit 'REQUEST_FULFILLED' to the platform donor (if applicable).
 *   5. Broadcast 'request-updated' to all dashboards.
 *
 * WHY two save paths?
 * For Internal donors, the donor data lives inside the hospital's User document,
 * so we call hospital.save() instead of targetDonor.save().
 * For Platform donors, targetDonor IS its own User document, so we call
 * targetDonor.save() directly.
 */
const assignDonor = async (req, res) => {
  try {
    const { assignedDonorId, phoneNumber } = req.body;
    const hospital = await User.findById(req.user._id);
    let targetDonor = null;
    let targetDonorType = null;

    // ── First: search internal walk-in donors ────────────────────────────────
    // Match by barcodeId (physical card scan) OR contact number (phone lookup)
    if (hospital?.internalDonorDatabase) {
      targetDonor = hospital.internalDonorDatabase.find(
        (donor) => (donor.barcodeId && donor.barcodeId === assignedDonorId) || (donor.contact && donor.contact === phoneNumber)
      );
      if (targetDonor) targetDonorType = 'Internal';
    }

    // ── Second: search platform User accounts (if not found internally) ──────
    if (!targetDonor && assignedDonorId && mongoose.isValidObjectId(assignedDonorId)) {
      targetDonor = await User.findById(assignedDonorId);
      if (targetDonor?.role === 'User') targetDonorType = 'Platform';
      else targetDonor = null; // ignore non-User accounts
    }

    if (!targetDonor) return res.status(404).json({ message: 'User Not Found.' });

    // Eligibility check (prototype always passes, real system checks 90-day cooldown)
    if (targetDonor.is_eligible === false || !checkEligibility(targetDonor.lastDonationDate)) {
      const cooldownDate = targetDonor.lastDonationDate
        ? new Date(new Date(targetDonor.lastDonationDate).getTime() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString()
        : 'unknown';
      return res.status(403).json({ message: `User found but ineligible: 90-day cooldown active until ${cooldownDate}.` });
    }

    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    // Mark the donor as ineligible for 90 days (donation completed)
    const now = new Date();
    if (targetDonorType === 'Internal') {
      // Internal donors live inside the hospital document as sub-documents.
      // We modify the sub-document in memory and save the parent document.
      targetDonor.lastDonationDate = now;
      targetDonor.is_eligible = false;
      targetDonor.donation_history.push(now);
      await hospital.save(); // saves the entire hospital User document
    } else {
      // Platform donors are standalone User documents.
      targetDonor.lastDonationDate = now;
      targetDonor.is_eligible = false;
      targetDonor.donation_history.push(now);
      await targetDonor.save();
    }

    // Mark the request as fulfilled
    request.assignedDonorId = targetDonorType === 'Internal' ? targetDonor.barcodeId : targetDonor._id.toString();
    request.assignedDonorType = targetDonorType;
    request.handledBy = req.user._id;
    request.status = 'Fulfilled';
    const updatedRequest = await request.save();

    // ── Notify involved parties via socket ───────────────────────────────────
    const io = req.app.get('io');
    if (io) {
      // Tell the original requester their request is fulfilled
      io.to(request.requester.toString()).emit('request-completed', {
        requestId: request._id,
        message: `Your blood request has been fulfilled by ${req.user.name}`,
      });

      // For platform donors, notify them directly in their personal room
      const donorId = targetDonorType === 'Platform' ? targetDonor._id.toString() : null;
      if (donorId) {
        io.to(donorId).emit('REQUEST_FULFILLED', {
          requestId: request._id,
          message: 'Thank you! The hospital has marked the request as fulfilled.',
        });
      }

      // Broadcast to everyone so all dashboards remove the card from Pending
      io.emit('request-updated', { requestId: request._id, status: 'Fulfilled' });
    }

    return res.json(updatedRequest);
  } catch (error) {
    console.error('assignDonor error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createRequest,
  getMyRequests,
  getIncomingRequests,
  getExternalRequirements,
  updateRequestStatus,
  getRequestMatches,
  assignDonor,
};
