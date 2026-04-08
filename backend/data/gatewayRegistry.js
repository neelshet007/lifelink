const facilities = require('./mock_facilities.json');
const MockFacilitiesRegistry = require('../models/MockFacilitiesRegistry');

const citizens = [
  {
    abhaAddress: 'neel@abha',
    givenName: 'Neel',
    familyName: 'Sharma',
    age: 29,
    gender: 'male',
    bloodGroup: 'O+',
    contact: '+91 98765 43210',
    coordinates: [77.5946, 12.9716],
    currentRegion: 'south-zone',
  },
  {
    abhaAddress: 'malaria@abha',
    givenName: 'Aarav',
    familyName: 'Menon',
    age: 26,
    gender: 'male',
    bloodGroup: 'A+',
    contact: '+91 99887 77665',
    coordinates: [77.209, 28.6139],
    currentRegion: 'north-zone',
  },
  {
    abhaAddress: 'patient@abha',
    givenName: 'Rohan',
    familyName: 'Iyer',
    age: 34,
    gender: 'male',
    bloodGroup: '',
    contact: '+91 90909 22110',
    coordinates: [72.8777, 19.076],
    currentRegion: 'west-zone',
  },
];

function buildCitizenFhirResource(citizen) {
  const birthYear = new Date().getFullYear() - citizen.age;
  const extensions = [
    {
      url: 'https://lifelink.app/fhir/StructureDefinition/role',
      valueString: 'User',
    },
    {
      url: 'https://lifelink.app/fhir/StructureDefinition/age',
      valueInteger: citizen.age,
    },
  ];

  if (citizen.bloodGroup) {
    extensions.push({
      url: 'https://lifelink.app/fhir/StructureDefinition/blood-group',
      valueString: citizen.bloodGroup,
    });
  }

  return {
    resourceType: 'Patient',
    id: citizen.abhaAddress.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
    identifier: [
      {
        system: 'https://healthid.ndhm.gov.in',
        value: citizen.abhaAddress,
      },
    ],
    name: [
      {
        use: 'official',
        family: citizen.familyName,
        given: [citizen.givenName],
      },
    ],
    gender: citizen.gender,
    birthDate: `${birthYear}-01-01`,
    telecom: [
      {
        system: 'phone',
        value: citizen.contact,
      },
    ],
    extension: extensions,
  };
}

function findCitizenByAbha(abhaAddress) {
  return citizens.find((entry) => entry.abhaAddress.toLowerCase() === String(abhaAddress).toLowerCase()) || null;
}

function normalizeFacility(entry) {
  return {
    hfrFacilityId: entry.hfrFacilityId,
    dcgiLicenseNumber: entry.dcgiLicenseNumber,
    role: entry.role,
    name: entry.name,
    email: entry.email,
    contact: entry.contact || '',
    address: entry.address,
    coordinates: entry.coordinates,
    licenseStatus: entry.licenseStatus,
    verificationBadge: entry.verificationBadge,
    facilityType: entry.facilityType,
    license_type: entry.license_type || '',
    currentRegion: entry.currentRegion || 'west-zone',
  };
}

async function findFacility(identifier, identityType) {
  const normalized = String(identifier).toLowerCase();
  const staticMatch = facilities.find((entry) => {
    if (identityType === 'HFR') {
      return entry.hfrFacilityId?.toLowerCase() === normalized && entry.role === 'Hospital';
    }
    return (
      entry.role === 'Blood Bank' &&
      (entry.dcgiLicenseNumber?.toLowerCase() === normalized || entry.hfrFacilityId?.toLowerCase() === normalized)
    );
  });

  if (staticMatch) {
    return normalizeFacility(staticMatch);
  }

  const dynamicQuery = identityType === 'HFR'
    ? {
        role: 'Hospital',
        $or: [{ hfrFacilityId: identifier }, { facilityAbdmId: identifier }],
      }
    : {
        role: 'Blood Bank',
        $or: [{ dcgiLicenseNumber: identifier }, { hfrFacilityId: identifier }, { facilityAbdmId: identifier }],
      };

  const dynamicMatch = await MockFacilitiesRegistry.findOne(dynamicQuery).lean();
  return dynamicMatch ? normalizeFacility(dynamicMatch) : null;
}

module.exports = {
  buildCitizenFhirResource,
  findCitizenByAbha,
  findFacility,
};
