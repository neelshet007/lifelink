const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: true
  },
  urgency: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  currentRegion: { type: String, default: 'south-zone' },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  status: {
    type: String,
    enum: ['Pending', 'Accepted', 'Blood Assigned', 'Fulfilled', 'Closed'],
    default: 'Pending'
  },
  acceptedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedDonorId: { type: String },
  assignedDonorType: { type: String, enum: ['Platform', 'Internal'] }
}, { timestamps: true });

requestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Request', requestSchema);
