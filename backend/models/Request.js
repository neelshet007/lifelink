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
    enum: ['Pending', 'Accepted', 'Blood Assigned', 'Fulfilled', 'Closed'],
    default: 'Pending'
  },
  acceptedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Array of potential responders
  
  // Who officially accepted/claimed the request (Hospital or Blood bank)
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Who actually fulfilled it (Platform User ID or Internal Donor ID string)
  assignedDonorId: { type: String },
  assignedDonorType: { type: String, enum: ['Platform', 'Internal'] }
}, { timestamps: true });

// Index for geospatial queries on requests
requestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Request', requestSchema);
