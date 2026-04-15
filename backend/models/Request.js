/**
 * ============================================================
 * FILE: backend/models/Request.js
 * ROLE: Mongoose Schema for blood / supply requests
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * A Request document is created when any actor (Hospital, Blood Bank,
 * or citizen User) needs blood. It travels through a lifecycle:
 *
 *   Pending → Accepted → Blood Assigned / Stock Confirmed → Fulfilled / Closed
 *
 * How a Request is created
 * ─────────────────────────
 * 1. REST: POST /api/requests (createRequest in requestController.js)
 *    - requester, senderName, senderType, senderId are read from the DB
 *      (NOT from the JWT or socket session) to prevent identity-swap bugs.
 *    - bloodGroup, urgency, requestType, bloodUnits come from req.body.
 *    - location (GeoJSON) is taken from the socket session's live GPS,
 *      falling back to the DB location if the session is inactive.
 *
 * 2. Socket: REQUEST_BLOOD event (socket/index.js meshBroadcast path)
 *    - If the client passes no requestId, a new Request is created
 *      in the socket handler directly (same fields as above).
 *
 * IDENTITY ISOLATION (the "Identity-Swap" fix)
 * --------------------------------------------
 * The sender (the entity that CREATED the request) and the receiver
 * (the entity that ACCEPTED it) are stored in completely separate fields:
 *
 *   Sender:   requester | senderName | senderType | senderId
 *   Receiver: handledBy | receiverName | receiverType | receiverId
 *
 * senderName is a plain String set ONCE at creation from the DB document.
 * It is NEVER updated by a socket event or PUT request. This prevents
 * the UI from showing the acceptor's name where the requester's name
 * should appear (the "Identity Swap" bug fixed in the previous sprint).
 *
 * Receiver fields are populated by:
 *   - socket/index.js → confirmRequest() / emitDonorAccepted()
 *   - requestController.js → updateRequestStatus() / assignDonor()
 *
 * WHY 2dsphere on location?
 * ─────────────────────────
 * The location field stores where the emergency is happening (the
 * requester's coordinates at creation time). It is used in:
 *   - getIncomingRequests(): filter donors within 5 km
 *   - getExternalRequirements(): filter facilities within 10 km
 *   - getRequestMatches(): rank platform users by distance from request
 *   - socket emitDonorAccepted(): compute ETA from donor to request point
 */

const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  // ── Sender (the entity who created this request) ─────────────────────────────
  // senderName is frozen at creation. It is read from the DB user document and
  // stored as a plain String so no socket event or update can change it.
  requester:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName:  { type: String, required: true },   // static — set once, never updated
  senderType:  { type: String, enum: ['Hospital', 'Blood Bank', 'User'], required: true, default: 'User' },
  senderId:    { type: String }, // HFR ID / ABHA ID / DCGI License (human-readable identity token)

  // ── Receiver (the entity that accepted / handled the request) ─────────────────
  // Populated only when someone accepts. Completely separate from sender fields.
  // confirmRequest() and emitDonorAccepted() write to these fields from the DB.
  receiverName: { type: String, default: null },
  receiverType: { type: String, enum: ['Hospital', 'Blood Bank', 'User', null], default: null },
  receiverId:   { type: String, default: null }, // MongoDB ObjectId as string

  // ── Blood request details ─────────────────────────────────────────────────────
  // All come from the client's req.body or socket payload. Validated by the
  // matching algorithm before being stored.
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: true
  },
  bloodUnits:  { type: Number, default: 1 },
  urgency:     { type: String, enum: ['Critical', 'Immediate', 'Standard'], default: 'Standard' },
  requestType: { type: String, enum: ['Blood Request', 'Supply Needed'], default: 'Blood Request' },

  // GeoJSON Point — where the emergency is occurring.
  // Coordinates = [longitude, latitude] (GeoJSON standard).
  // Used for proximity calculations in the controller and socket handler.
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },

  // Current lifecycle stage of the request.
  // Controllers and socket handlers update this as responses arrive.
  status: {
    type: String,
    enum: ['Pending', 'Accepted', 'Blood Assigned', 'Fulfilled', 'Closed', 'Expired', 'Stock Confirmed'],
    default: 'Pending'
  },

  // ── Legacy / tracking fields ──────────────────────────────────────────────────
  // acceptedBy: list of all users who clicked Accept (multi-responder tracking)
  // handledBy: the primary responder (single facility / user who "owns" the request)
  // assignedDonorId: ID of the donor actually assigned by the hospital
  // assignedDonorType: 'Platform' (registered) | 'Internal' (hospital walk-in)
  // notifiedDonorCount: how many sockets received the mesh alert (for analytics)
  acceptedBy:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  handledBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedDonorId:    { type: String },
  assignedDonorType:  { type: String, enum: ['Platform', 'Internal', 'Blood Bank'] },
  notifiedDonorCount: { type: Number, default: 0 }
}, { timestamps: true }); // createdAt / updatedAt

// 2dsphere index enables MongoDB geospatial queries on the location field.
requestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Request', requestSchema);
