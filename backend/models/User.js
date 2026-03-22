const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['Donor', 'Patient', 'Hospital', 'Blood Bank', 'Admin'],
    required: true
  },
  bloodGroup: { 
    type: String, 
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: function() { return this.role === 'Donor' || this.role === 'Patient'; }
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  // Donor specific
  lastDonationDate: { type: Date },
  isAvailable: { type: Boolean, default: true },
  
  // Hospital/Blood Bank specific
  inventory: {
    type: Map,
    of: Number,
    default: {}
  }
}, { timestamps: true });

// Index for geospatial queries
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
