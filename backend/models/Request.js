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
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  status: {
    type: String,
    enum: ['Pending', 'Accepted', 'Fulfilled', 'Closed'],
    default: 'Pending'
  },
  acceptedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  fulfilledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Index for geospatial queries on requests
requestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Request', requestSchema);
