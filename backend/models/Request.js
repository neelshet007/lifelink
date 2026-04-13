const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  // ── Sender (the entity who created this request) ─────────────────────────────
  // senderName is frozen at creation. It is read from the DB user document and
  // stored as a plain String so no socket event or update can change it.
  requester:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName:  { type: String, required: true },   // static — set once, never updated
  senderType:  { type: String, enum: ['Hospital', 'Blood Bank', 'User'], required: true, default: 'User' },
  senderId:    { type: String }, // HFR ID / ABHA ID / DCGI License

  // ── Receiver (the entity that accepted / handled the request) ─────────────────
  // Populated only when someone accepts. Completely separate from sender fields.
  receiverName: { type: String, default: null },
  receiverType: { type: String, enum: ['Hospital', 'Blood Bank', 'User', null], default: null },
  receiverId:   { type: String, default: null },

  // ── Blood request details ─────────────────────────────────────────────────────
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: true
  },
  bloodUnits:  { type: Number, default: 1 },
  urgency:     { type: String, enum: ['Critical', 'Immediate', 'Standard'], default: 'Standard' },
  requestType: { type: String, enum: ['Blood Request', 'Supply Needed'], default: 'Blood Request' },

  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },

  status: {
    type: String,
    enum: ['Pending', 'Accepted', 'Blood Assigned', 'Fulfilled', 'Closed', 'Expired', 'Stock Confirmed'],
    default: 'Pending'
  },

  // Legacy / tracking fields
  acceptedBy:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  handledBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedDonorId:    { type: String },
  assignedDonorType:  { type: String, enum: ['Platform', 'Internal', 'Blood Bank'] },
  notifiedDonorCount: { type: Number, default: 0 }
}, { timestamps: true });

requestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Request', requestSchema);

