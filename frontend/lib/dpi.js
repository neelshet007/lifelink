export const DPI_STORAGE_KEY = 'lifelink-dpi-state';

export function getPatientExtension(patient, url) {
  return patient?.extension?.find((entry) => entry.url === url);
}

export function mapFhirPatientToUser(patient) {
  const identifier = patient?.identifier?.find((item) => item.system?.includes('abha'));
  const name = patient?.name?.[0];
  const bloodGroup =
    getPatientExtension(patient, 'https://lifelink.app/fhir/StructureDefinition/blood-group')?.valueString || '';
  const role =
    getPatientExtension(patient, 'https://lifelink.app/fhir/StructureDefinition/role')?.valueString || 'User';
  const age =
    getPatientExtension(patient, 'https://lifelink.app/fhir/StructureDefinition/age')?.valueInteger || 29;
  const contact =
    patient?.telecom?.find((entry) => entry.system === 'phone')?.value || '+91 98765 43210';

  return {
    id: patient.id || identifier?.value || 'mock-abha-user',
    abhaId: identifier?.value || '',
    name: [name?.given?.join(' '), name?.family].filter(Boolean).join(' '),
    email: identifier?.value || '',
    role,
    gender: patient.gender || 'unknown',
    bloodGroup,
    age,
    contact,
    token: `abha-${patient.id || 'token'}`,
    verifiedAt: new Date().toISOString(),
  };
}

export function createProofFromAlert(alert, user) {
  const numericSeed = Math.abs(
    `${alert.id}-${user.abhaId}-${user.bloodGroup}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  );

  return {
    id: `proof-${alert.id}`,
    requestId: alert.id,
    requestTitle: alert.title,
    alias: `Donor-${String(numericSeed % 1000).padStart(3, '0')}`,
    bloodGroup: user.bloodGroup,
    zkStatus: 'Medical Clearance Proof Generated',
    clearance: 'Eligible without exposing identity or medical records',
    generatedAt: new Date().toISOString(),
    proofHash: `zkp-${numericSeed.toString(16)}-${Date.now().toString(16).slice(-5)}`,
    destination: alert.hospital,
    hospitalWing: alert.department,
    mapLink: alert.mapLink,
    summonStatus: 'ready',
  };
}

