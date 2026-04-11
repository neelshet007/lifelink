const mongoose = require('mongoose');

const mockSandboxRegistrySchema = new mongoose.Schema({
  abhaNumber: { type: String, required: true, unique: true, trim: true },
  abhaAddress: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true },
  aadhaarNumber: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  gender: { type: String, default: 'unknown' },
  dob: { type: String, default: '1990-01-01' },
  bloodGroup: { type: String, default: '' },
  verificationTier: { type: String, enum: ['Facility-Verified', 'Unverified (Emergency Only)'], default: 'Unverified (Emergency Only)' },
  verificationSourceId: { type: String, default: '' },
  fhirBundle: { type: Object, required: true },
}, { timestamps: true, collection: 'mock_sandbox_registry' });

module.exports = mongoose.model('MockSandboxRegistry', mockSandboxRegistrySchema);
