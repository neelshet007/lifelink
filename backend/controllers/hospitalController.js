const User = require('../models/User');

// @desc    Add an internal donor
// @route   POST /api/hospital/donors
const addInternalDonor = async (req, res) => {
  try {
    const { name, age, bloodGroup, contact, barcodeId, donationHistory, isAvailable, lastDonationDate, is_eligible } = req.body;

    if (!name || !age || !bloodGroup || !contact || !barcodeId) {
      return res.status(400).json({ message: 'Name, Age, Blood Group, Contact, and Barcode ID are required.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.internalDonorDatabase.push({
      name, age, bloodGroup, contact, barcodeId, donationHistory, isAvailable, lastDonationDate, is_eligible
    });

    await user.save();
    res.status(201).json(user.internalDonorDatabase);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @desc    Get all internal donors
// @route   GET /api/hospital/donors
const getInternalDonors = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json(user.internalDonorDatabase);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update an internal donor
// @route   PUT /api/hospital/donors/:id
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

module.exports = {
  addInternalDonor,
  getInternalDonors,
  updateInternalDonor
};
