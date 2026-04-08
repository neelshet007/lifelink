const mongoose = require('mongoose');

const facilityLedgerEntrySchema = new mongoose.Schema({
  abhaAddress: { type: String, required: true, trim: true },
  donorName: { type: String, required: true },
  gender: { type: String, required: true },
  dob: { type: String, required: true },
  bloodGroup: { type: String, default: '' },
  verificationTier: { type: String, default: 'Unverified (Emergency Only)' },
  verificationSourceId: { type: String, default: '' },
  source: { type: String, default: 'mock_sandbox_registry' },
}, { _id: true, timestamps: true });

const facilityLedgerSchema = new mongoose.Schema({
  facilityUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  facilityName: { type: String, required: true },
  facilityRole: { type: String, required: true },
  entries: [facilityLedgerEntrySchema],
}, { timestamps: true, collection: 'facility_ledgers' });

module.exports = mongoose.model('FacilityLedger', facilityLedgerSchema);
