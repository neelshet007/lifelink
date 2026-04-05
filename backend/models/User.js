const mongoose = require('mongoose');

const internalDonorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  bloodGroup: { 
    type: String, 
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], 
    required: true 
  },
  contact: { type: String, required: true },
  barcodeId: { type: String, required: true },  // Sample/ID barcode
  donationHistory: { type: String, default: '' }, // e.g. "2 donations"
  donation_history: [{ type: Date }],
  lastDonationDate: { type: Date },
  isAvailable: { type: Boolean, default: true },
  is_eligible: { type: Boolean, default: true }
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  contact: { type: String },
  age: { type: Number },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['User', 'Hospital', 'Blood Bank', 'Admin'],
    required: true
  },
  bloodGroup: { 
    type: String, 
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''],
    required: function() { return this.role === 'User'; }
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  // Unified User generic fields
  lastDonationDate: { type: Date },
  donation_history: [{ type: Date }],
  isAvailable: { type: Boolean, default: true },
  is_eligible: { type: Boolean, default: true },
  
  // Hospital/Blood Bank specific internal DB
  internalDonorDatabase: [internalDonorSchema],
  
  inventory: {
    type: Map,
    of: Number,
    default: {}
  }
}, { timestamps: true });

// Index for geospatial queries
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
