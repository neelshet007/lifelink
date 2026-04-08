const mongoose = require('mongoose');

const mockSandboxRegistrySchema = new mongoose.Schema({
  abhaNumber: { type: String, required: true, unique: true, trim: true },
  abhaAddress: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true },
  aadhaarNumber: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  gender: { type: String, required: true },
  dob: { type: String, required: true },
  bloodGroup: { type: String, default: '' },
  currentRegion: { type: String, required: true, default: 'south-zone' },
  verificationTier: { type: String, enum: ['Facility-Verified', 'Unverified (Emergency Only)'], default: 'Unverified (Emergency Only)' },
  verificationSourceId: { type: String, default: '' },
  fhirBundle: { type: Object, required: true },
}, { timestamps: true, collection: 'mock_sandbox_registry' });

module.exports = mongoose.model('MockSandboxRegistry', mockSandboxRegistrySchema);
