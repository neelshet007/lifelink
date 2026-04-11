const mongoose = require('mongoose');

const mockFacilitiesRegistrySchema = new mongoose.Schema({
  facilityAbdmId: { type: String, required: true, unique: true, trim: true },
  hfrFacilityId: { type: String, required: true, unique: true, trim: true },
  dcgiLicenseNumber: { type: String, unique: true, sparse: true, trim: true },
  role: { type: String, enum: ['Hospital', 'Blood Bank'], required: true },
  name: { type: String, required: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  governmentRegNo: { type: String, required: true, trim: true },
  adminAadhaar: { type: String, required: true, trim: true },
  contact: { type: String, default: '' },
  address: { type: String, default: 'Mumbai, Maharashtra' },
  coordinates: { type: [Number], default: [72.8777, 19.076] },
  hfrCertificateNumber: { type: String, required: true, trim: true },
  hfrCertificateUrl: { type: String, default: '' },
  mockDcgiLicenseUrl: { type: String, default: '' },
  licenseStatus: { type: String, default: 'Active' },
  verificationBadge: { type: String, default: 'Verified by NHA' },
  facilityType: { type: String, default: 'Registered Facility' },
  license_type: { type: String, default: '' },
}, { timestamps: true, collection: 'mock_facilities_registry' });

module.exports = mongoose.model('MockFacilitiesRegistry', mockFacilitiesRegistrySchema);
