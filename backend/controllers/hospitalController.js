const User = require('../models/User');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const FacilityLedger = require('../models/FacilityLedger');

const addInternalDonor = async (req, res) => {
  try {
    const { name, age, bloodGroup, contact, barcodeId, donationHistory, isAvailable, lastDonationDate, is_eligible } = req.body;
    if (!name || !age || !bloodGroup || !contact || !barcodeId) {
      return res.status(400).json({ message: 'Name, Age, Blood Group, Contact, and Barcode ID are required.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.internalDonorDatabase.push({ name, age, bloodGroup, contact, barcodeId, donationHistory, isAvailable, lastDonationDate, is_eligible });
    await user.save();
    res.status(201).json(user.internalDonorDatabase);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const getInternalDonors = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json(user.internalDonorDatabase);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const updateInternalDonor = async (req, res) => {
  try {
    const { name, bloodGroup, contact, isAvailable, lastDonationDate, is_eligible } = req.body;
    const user = await User.findById(req.user._id);
    const donor = user.internalDonorDatabase.id(req.params.id);
    if (!donor) return res.status(404).json({ message: 'Donor not found' });

    if (name) donor.name = name;
    if (bloodGroup) donor.bloodGroup = bloodGroup;
    if (contact) donor.contact = contact;
    if (isAvailable !== undefined) donor.isAvailable = isAvailable;
    if (lastDonationDate) donor.lastDonationDate = lastDonationDate;
    if (is_eligible !== undefined) donor.is_eligible = is_eligible;

    await user.save();
    res.json(donor);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const fetchSandboxProfile = async (req, res) => {
  try {
    const profile = await MockSandboxRegistry.findOne({ abhaAddress: req.params.abhaAddress.toLowerCase() });
    if (!profile) return res.status(404).json({ message: 'ABHA profile not found in mock sandbox registry.' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const addSandboxProfileToLedger = async (req, res) => {
  try {
    const { abhaAddress } = req.body;
    const profile = await MockSandboxRegistry.findOne({ abhaAddress: String(abhaAddress).toLowerCase() });
    if (!profile) return res.status(404).json({ message: 'ABHA profile not found in mock sandbox registry.' });

    const ledger = await FacilityLedger.findOneAndUpdate(
      { facilityUserId: req.user._id },
      { $setOnInsert: { facilityUserId: req.user._id, facilityName: req.user.name, facilityRole: req.user.role } },
      { new: true, upsert: true }
    );

    const existing = ledger.entries.find((entry) => entry.abhaAddress === profile.abhaAddress);
    if (!existing) {
      ledger.entries.push({
        abhaAddress: profile.abhaAddress,
        donorName: profile.name,
        gender: profile.gender,
        dob: profile.dob,
        bloodGroup: profile.bloodGroup || '',
        verificationTier: profile.verificationTier,
        verificationSourceId: profile.verificationSourceId,
      });
      await ledger.save();
    }

    res.status(201).json(ledger);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const getFacilityLedger = async (req, res) => {
  try {
    const ledger = await FacilityLedger.findOne({ facilityUserId: req.user._id });
    res.json(ledger || { facilityUserId: req.user._id, entries: [] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const exportFacilityLedger = async (req, res) => {
  try {
    const ledger = await FacilityLedger.findOne({ facilityUserId: req.user._id });
    const entries = ledger?.entries || [];
    const rows = [
      ['ABHA ID', 'Name', 'Gender', 'DOB', 'Blood Group', 'Verification Tier', 'Verification Source ID', 'Added At'],
      ...entries.map((entry) => [entry.abhaAddress, entry.donorName, entry.gender, entry.dob, entry.bloodGroup, entry.verificationTier, entry.verificationSourceId, entry.createdAt?.toISOString?.() || ''])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.user.name.replace(/\s+/g, '-').toLowerCase()}-drive-data.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  addInternalDonor,
  getInternalDonors,
  updateInternalDonor,
  fetchSandboxProfile,
  addSandboxProfileToLedger,
  getFacilityLedger,
  exportFacilityLedger,
};
