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
  barcodeId: { type: String, required: true },
  donationHistory: { type: String, default: '' },
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
  identityType: {
    type: String,
    enum: ['ABHA', 'HFR', 'DCGI', 'LOCAL'],
    default: 'LOCAL'
  },
  abhaAddress: { type: String, unique: true, sparse: true, trim: true },
  hfrFacilityId: { type: String, unique: true, sparse: true, trim: true },
  dcgiLicenseNumber: { type: String, unique: true, sparse: true, trim: true },
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''],
    default: ''
  },
  donorFeaturesEnabled: { type: Boolean, default: true },
  nhcxConsent: { type: Boolean, default: false },
  verificationBadge: { type: String, default: '' },
  verificationSource: { type: String, default: '' },
  facilityAddress: { type: String, default: '' },
  facilityType: { type: String, default: '' },
  licenseStatus: { type: String, default: '' },
  license_type: { type: String, default: '' },
  verificationTier: { type: String, default: 'Facility-Verified' },
  verificationSourceId: { type: String, default: '' },
  lastAbdmSyncAt: { type: Date },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  lastDonationDate: { type: Date },
  donation_history: [{ type: Date }],
  isAvailable: { type: Boolean, default: true },
  is_eligible: { type: Boolean, default: true },
  internalDonorDatabase: [internalDonorSchema],
  inventory: {
    type: Map,
    of: Number,
    default: {}
  }
}, { timestamps: true });

userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
