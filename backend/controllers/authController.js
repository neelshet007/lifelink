const User = require('../models/User');
const MockSandboxRegistry = require('../models/MockSandboxRegistry');
const MockFacilitiesRegistry = require('../models/MockFacilitiesRegistry');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {
  buildCitizenFhirResource,
  findCitizenByAbha,
  findFacility,
} = require('../data/gatewayRegistry');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const serializeUser = (user) => ({
  _id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  bloodGroup: user.bloodGroup || '',
  age: user.age || null,
  contact: user.contact || '',
  identityType: user.identityType || 'LOCAL',
  abhaAddress: user.abhaAddress || '',
  hfrFacilityId: user.hfrFacilityId || '',
  dcgiLicenseNumber: user.dcgiLicenseNumber || '',
  donorFeaturesEnabled: user.donorFeaturesEnabled !== false,
  nhcxConsent: Boolean(user.nhcxConsent),
  verificationBadge: user.verificationBadge || '',
  verificationSource: user.verificationSource || '',
  facilityAddress: user.facilityAddress || '',
  facilityType: user.facilityType || '',
  licenseStatus: user.licenseStatus || '',
  license_type: user.license_type || '',
  verificationTier: user.verificationTier || 'Facility-Verified',
  verificationSourceId: user.verificationSourceId || '',
  location: user.location || { type: 'Point', coordinates: [0, 0] },
  currentCoords: user.location?.coordinates || [0, 0],
  lastAbdmSyncAt: user.lastAbdmSyncAt || null,
});

const buildFhirResourceFromUser = (user) => ({
  resourceType: 'Patient',
  id: user.id,
  identifier: [{ system: 'https://healthid.ndhm.gov.in', value: user.abhaAddress }],
  name: [{ use: 'official', family: user.name.split(' ').slice(1).join(' ') || user.name, given: [user.name.split(' ')[0]] }],
  gender: user.gender || 'unknown',
  birthDate: user.dob || undefined,
  telecom: user.contact ? [{ system: 'phone', value: user.contact }] : [],
  extension: [
    { url: 'https://lifelink.app/fhir/StructureDefinition/role', valueString: 'User' },
    { url: 'https://lifelink.app/fhir/StructureDefinition/age', valueInteger: user.age || 0 },
    ...(user.bloodGroup ? [{ url: 'https://lifelink.app/fhir/StructureDefinition/blood-group', valueString: user.bloodGroup }] : []),
  ],
});

const getExistingQuery = (identityType, identifier) => {
  if (identityType === 'ABHA') return { abhaAddress: identifier.toLowerCase() };
  if (identityType === 'HFR') return { hfrFacilityId: identifier };
  return { $or: [{ dcgiLicenseNumber: identifier }, { hfrFacilityId: identifier }] };
};

const resolveRegistryRecord = async (identityType, identifier) => {
  if (identityType === 'ABHA') {
    const sandboxRecord = await MockSandboxRegistry.findOne({
      $or: [
        { abhaAddress: identifier.toLowerCase() },
        { abhaNumber: identifier },
      ],
    });
    if (sandboxRecord) {
      return {
        identityType,
        role: 'User',
        profile: {
          abhaAddress: sandboxRecord.abhaAddress,
          givenName: sandboxRecord.name.split(' ')[0],
          familyName: sandboxRecord.name.split(' ').slice(1).join(' ') || sandboxRecord.name,
          age: Math.max(18, new Date().getFullYear() - Number(sandboxRecord.dob.slice(0, 4))),
          gender: sandboxRecord.gender,
          bloodGroup: sandboxRecord.bloodGroup,
          contact: '',
          coordinates: [0, 0],
        },
        fhirPatient: sandboxRecord.fhirBundle.entry?.find((entry) => entry.resource?.resourceType === 'Patient')?.resource,
        displayName: sandboxRecord.name,
      };
    }

    const citizen = findCitizenByAbha(identifier);
    if (!citizen) return null;
    return {
      identityType,
      role: 'User',
      profile: citizen,
      fhirPatient: buildCitizenFhirResource(citizen),
      displayName: `${citizen.givenName} ${citizen.familyName}`,
    };
  }

  const facility = await findFacility(identifier, identityType);
  if (!facility) return null;
  return { identityType, role: facility.role, profile: facility, displayName: facility.name };
};

const buildProvisionedUserData = async (record, identifier) => {
  const hashedPassword = await bcrypt.hash(`gateway-${String(identifier).toLowerCase()}`, 10);

  if (record.identityType === 'ABHA') {
    const citizen = record.profile;
    return {
      name: `${citizen.givenName} ${citizen.familyName}`,
      email: `${citizen.abhaAddress.replace('@', '.')}.lifelink@abdm.local`,
      contact: citizen.contact,
      age: citizen.age,
      password: hashedPassword,
      role: 'User',
      identityType: 'ABHA',
      abhaAddress: citizen.abhaAddress.toLowerCase(),
      bloodGroup: citizen.bloodGroup || '',
      donorFeaturesEnabled: Boolean(citizen.bloodGroup),
      verificationBadge: 'ABDM Verified Citizen',
      verificationSource: 'ABDM Sandbox',
      verificationTier: citizen.bloodGroup ? 'Facility-Verified' : 'Unverified (Emergency Only)',
      lastAbdmSyncAt: new Date(),
      location: { type: 'Point', coordinates: citizen.coordinates || [0, 0] },
    };
  }

  const facility = record.profile;
  return {
    name: facility.name,
    email: facility.email,
    contact: facility.contact,
    age: 1,
    password: hashedPassword,
    role: facility.role,
    identityType: record.identityType,
    hfrFacilityId: facility.hfrFacilityId,
    ...(facility.dcgiLicenseNumber ? { dcgiLicenseNumber: facility.dcgiLicenseNumber } : {}),
    donorFeaturesEnabled: false,
    verificationBadge: facility.verificationBadge,
    verificationSource: 'NHA HFR Registry',
    verificationTier: 'Facility-Verified',
    facilityAddress: facility.address,
    facilityType: facility.facilityType,
    licenseStatus: facility.licenseStatus,
    ...(facility.license_type ? { license_type: facility.license_type } : {}),
    lastAbdmSyncAt: new Date(),
    location: { type: 'Point', coordinates: facility.coordinates },
  };
};

const buildGatewayResponse = (user, status, identityType, fhirPatient = null) => ({
  status,
  syncMode: status === 'existing' ? '90_day_sync' : 'sandbox_initialization_complete',
  token: generateToken(user.id),
  user: serializeUser(user),
  fhirPatient: identityType === 'ABHA' ? fhirPatient || buildFhirResourceFromUser(user) : null,
  onboarding: {
    requiresLocationAccess: true,
    requiresBloodGroupVerification: user.role === 'User' && !user.bloodGroup,
    donorFeaturesEnabled: user.role !== 'User' || Boolean(user.bloodGroup),
    requiresNhcxConsent: user.role === 'User',
  },
});

const registerUser = async (req, res) => {
  try {
    const { name, email, contact, age, password, role, bloodGroup, latitude, longitude } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      contact,
      age: age ? parseInt(age, 10) : undefined,
      password: hashedPassword,
      role,
      identityType: 'LOCAL',
      donorFeaturesEnabled: role !== 'User' || Boolean(bloodGroup),
      verificationTier: 'Facility-Verified',
      ...(role === 'User' ? { bloodGroup } : {}),
      location: { type: 'Point', coordinates: [parseFloat(longitude) || 0, parseFloat(latitude) || 0] },
    });

    res.status(201).json({ ...serializeUser(user), token: generateToken(user.id) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ $or: [{ email }, { contact: email }] });
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({ ...serializeUser(user), token: generateToken(user.id) });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const initiateGatewayLogin = async (req, res) => {
  try {
    const { identityType, identifier } = req.body;
    const normalizedIdentifier = identityType === 'ABHA' ? identifier.toLowerCase() : identifier;
    const existingUser = await User.findOne(getExistingQuery(identityType, normalizedIdentifier));
    if (existingUser) {
      existingUser.lastAbdmSyncAt = new Date();
      await existingUser.save();
      return res.json(buildGatewayResponse(existingUser, 'existing', identityType));
    }

    const registryRecord = await resolveRegistryRecord(identityType, normalizedIdentifier);
    if (!registryRecord) {
      return res.status(404).json({ message: 'Identifier not found in the ABDM Sandbox or HFR registry.' });
    }

    return res.json({
      status: 'provision_required',
      syncMode: 'sandbox_initialization',
      message: 'No LifeLink record found. Redirecting to ABDM Sandbox to initialize your Verified Health Profile...',
      identityType,
      displayName: registryRecord.displayName,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const completeGatewayLogin = async (req, res) => {
  try {
    const { identityType, identifier } = req.body;
    const normalizedIdentifier = identityType === 'ABHA' ? identifier.toLowerCase() : identifier;
    const existingUser = await User.findOne(getExistingQuery(identityType, normalizedIdentifier));
    if (existingUser) {
      existingUser.lastAbdmSyncAt = new Date();
      await existingUser.save();
      return res.json(buildGatewayResponse(existingUser, 'existing', identityType));
    }

    const registryRecord = await resolveRegistryRecord(identityType, normalizedIdentifier);
    if (!registryRecord) return res.status(404).json({ message: 'Identifier not found in the ABDM Sandbox or HFR registry.' });

    const userData = await buildProvisionedUserData(registryRecord, normalizedIdentifier);
    const createdUser = await User.create(userData);
    return res.status(201).json(buildGatewayResponse(createdUser, 'provisioned', identityType, registryRecord.fhirPatient || null));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const registerMockAbha = async (req, res) => {
  try {
    const { name, aadhaar, email } = req.body;
    const dob = req.body.dob || '1998-01-01';
    const gender = req.body.gender || 'unknown';
    const firstToken = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || 'user';
    let randomSuffix = String(Math.floor(1000 + Math.random() * 9000));
    let abhaAddress = `${firstToken}.${randomSuffix}@abdm`;
    while (await MockSandboxRegistry.findOne({ abhaAddress })) {
      randomSuffix = String(Math.floor(1000 + Math.random() * 9000));
      abhaAddress = `${firstToken}.${randomSuffix}@abdm`;
    }

    let abhaNumber = '';
    do {
      abhaNumber = `${Math.floor(1000000 + Math.random() * 9000000)}${Math.floor(1000000 + Math.random() * 9000000)}`;
    } while (await MockSandboxRegistry.findOne({ abhaNumber }));

    const age = Math.max(18, new Date().getFullYear() - Number(String(dob).slice(0, 4)));
    const patient = {
      resourceType: 'Patient',
      id: abhaAddress.replace(/[^a-zA-Z0-9]/g, '-'),
      identifier: [
        { system: 'https://healthid.ndhm.gov.in/address', value: abhaAddress },
        { system: 'https://healthid.ndhm.gov.in/number', value: abhaNumber },
      ],
      name: [{ given: [name.split(' ')[0]], family: name.split(' ').slice(1).join(' ') || name }],
      gender,
      birthDate: dob,
      telecom: [{ system: 'email', value: email }],
      extension: [
        { url: 'https://lifelink.app/fhir/StructureDefinition/role', valueString: 'User' },
        { url: 'https://lifelink.app/fhir/StructureDefinition/age', valueInteger: age },
      ],
    };

    const bundle = { resourceType: 'Bundle', type: 'collection', entry: [{ resource: patient }] };
    const sandboxProfile = await MockSandboxRegistry.create({
      abhaNumber,
      abhaAddress,
      name,
      aadhaarNumber: aadhaar,
      email,
      gender,
      dob,
      fhirBundle: bundle,
    });

    const userData = await buildProvisionedUserData({
      identityType: 'ABHA',
      profile: {
        abhaAddress,
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || name,
        age,
        gender,
        bloodGroup: '',
        contact: '',
        coordinates: [0, 0],
      },
    }, abhaAddress);
    userData.email = email.toLowerCase();
    const user = await User.create(userData);

    res.status(201).json({
      token: generateToken(user.id),
      user: serializeUser(user),
      fhirPatient: patient,
      sandboxProfileId: sandboxProfile.id,
      credentials: {
        abhaNumber,
        abhaAddress,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const updateCurrentLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.location = {
      type: 'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)],
    };
    await user.save();

    res.json({ user: serializeUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const registerFacilityOnboarding = async (req, res) => {
  try {
    const {
      facilityName,
      category,
      governmentRegNo,
      administratorAadhaar,
      email,
      contact = '',
      address = 'Mumbai, Maharashtra',
      latitude,
      longitude,
    } = req.body;
    const cityCode = 'MUM';
    let facilityAbdmId = '';
    let hfrFacilityId = '';
    let dcgiLicenseNumber = '';
    let hfrCertificateNumber = '';

    do {
      facilityAbdmId = `FAC-${cityCode}-${Math.floor(1000 + Math.random() * 9000)}`;
    } while (await MockFacilitiesRegistry.findOne({ facilityAbdmId }));

    do {
      hfrFacilityId = `${Math.floor(1000000 + Math.random() * 9000000)}`;
    } while (await MockFacilitiesRegistry.findOne({ hfrFacilityId }));

    if (category === 'Blood Bank') {
      do {
        dcgiLicenseNumber = `LC-DCGI-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      } while (await MockFacilitiesRegistry.findOne({ dcgiLicenseNumber }));
    }

    do {
      hfrCertificateNumber = `HFR-CERT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    } while (await MockFacilitiesRegistry.findOne({ hfrCertificateNumber }));

    const lng = Number.isFinite(Number(longitude)) ? Number(longitude) : 72.8777;
    const lat = Number.isFinite(Number(latitude)) ? Number(latitude) : 19.076;

    const registryRecord = await MockFacilitiesRegistry.create({
      facilityAbdmId,
      hfrFacilityId,
      ...(dcgiLicenseNumber ? { dcgiLicenseNumber } : {}),
      role: category,
      name: facilityName,
      email,
      governmentRegNo,
      adminAadhaar: administratorAadhaar,
      contact,
      address,
      coordinates: [lng, lat],
      hfrCertificateNumber,
      hfrCertificateUrl: `mock://registry/${hfrCertificateNumber}`,
      ...(dcgiLicenseNumber ? { mockDcgiLicenseUrl: `mock://registry/${dcgiLicenseNumber}` } : {}),
      licenseStatus: 'Active',
      verificationBadge: 'Verified by NHA',
      facilityType: category === 'Hospital' ? 'Registered Hospital' : 'Registered Blood Bank',
      license_type: category === 'Blood Bank' ? 'DCGI_Verified' : '',
    });

    const userData = await buildProvisionedUserData({
      identityType: category === 'Hospital' ? 'HFR' : 'DCGI',
      profile: {
        hfrFacilityId,
        ...(dcgiLicenseNumber ? { dcgiLicenseNumber } : {}),
        role: category,
        name: facilityName,
        email,
        contact,
        address: registryRecord.address,
        coordinates: registryRecord.coordinates,
        licenseStatus: registryRecord.licenseStatus,
        verificationBadge: registryRecord.verificationBadge,
        facilityType: registryRecord.facilityType,
        license_type: registryRecord.license_type,
      },
    }, category === 'Hospital' ? hfrFacilityId : dcgiLicenseNumber);

    const user = await User.create(userData);

    res.status(201).json({
      token: generateToken(user.id),
      user: serializeUser(user),
      credentials: {
        facilityAbdmId,
        hfrFacilityId,
        hfrCertificateNumber,
        ...(dcgiLicenseNumber ? { dcgiLicenseNumber } : {}),
      },
      registryId: registryRecord.id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const completeTieredProfile = async (req, res) => {
  try {
    const { bloodGroup, verificationSourceId } = req.body;
    const facility = await findFacility(verificationSourceId, 'HFR') || await findFacility(verificationSourceId, 'DCGI');
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.bloodGroup = bloodGroup;
    user.donorFeaturesEnabled = true;
    user.verificationTier = facility ? 'Facility-Verified' : 'Unverified (Emergency Only)';
    user.verificationSourceId = verificationSourceId;
    await user.save();

    await MockSandboxRegistry.findOneAndUpdate(
      { abhaAddress: user.abhaAddress },
      {
        $set: {
          bloodGroup,
          verificationTier: user.verificationTier,
          verificationSourceId,
          'fhirBundle.entry.0.resource.extension': [
            { url: 'https://lifelink.app/fhir/StructureDefinition/role', valueString: 'User' },
            { url: 'https://lifelink.app/fhir/StructureDefinition/age', valueInteger: user.age || 18 },
            { url: 'https://lifelink.app/fhir/StructureDefinition/blood-group', valueString: bloodGroup },
          ],
        },
      }
    );

    res.json({ token: generateToken(user.id), user: serializeUser(user), fhirPatient: buildFhirResourceFromUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  initiateGatewayLogin,
  completeGatewayLogin,
  registerMockAbha,
  registerFacilityOnboarding,
  completeTieredProfile,
  updateCurrentLocation,
};
