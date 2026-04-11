/**
 * Mathematical formula to calculate distance between two coordinates in kilometers.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in km
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);  
  const dLon = (lon2 - lon1) * (Math.PI / 180); 
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c; 
}

function isBloodGroupCompatible(donorBloodGroup, requestedBloodGroup) {
  if (!donorBloodGroup || !requestedBloodGroup) return false;
  if (donorBloodGroup === requestedBloodGroup) return true;
  if (donorBloodGroup === 'O-') return true;
  if (requestedBloodGroup === 'AB+') return true;

  const base = (bg) => String(bg).replace('+', '').replace('-', '');
  const isPositive = (bg) => String(bg).includes('+');

  return base(donorBloodGroup) === base(requestedBloodGroup)
    && isPositive(requestedBloodGroup)
    && !isPositive(donorBloodGroup);
}

/**
 * Calculates a match score (max 1.0) based on formula:
 * (0.4 * Distance Score) + (0.3 * Compatibility Score) + (0.2 * Availability Score) + (0.1 * Eligibility Score)
 * 
 * @param {number} distance - Distance in km
 * @param {string} bloodCompatibility - 'Exact', 'Compatible', or 'Not compatible'
 * @param {boolean} isAvailable - Donor availability
 * @param {number|null} lastDonationDaysAgo - Days since last donation
 * @returns {number} matching score between 0 and 1
 */
function calculateScore(distance, bloodCompatibility, isAvailable, lastDonationDaysAgo) {
  // Distance Score 
  let distanceScore = 0;
  if (distance < 5) distanceScore = 1;
  else if (distance <= 10) distanceScore = 0.8;
  else if (distance <= 20) distanceScore = 0.6;
  else distanceScore = 0.3;

  // Compatibility Score
  let compScore = 0;
  if (bloodCompatibility === 'Exact') compScore = 1;
  else if (bloodCompatibility === 'Compatible') compScore = 0.7;
  else compScore = 0;

  // Availability Score
  const availabilityScore = isAvailable ? 1 : 0;

  // Eligibility Score
  const eligibilityScore = (lastDonationDaysAgo === null || lastDonationDaysAgo >= 90) ? 1 : 0;

  return (0.4 * distanceScore) + (0.3 * compScore) + (0.2 * availabilityScore) + (0.1 * eligibilityScore);
}

function filterUsersWithinRadius(users, latitude, longitude, radiusKm = 5) {
  return users.filter((user) => {
    const userLatitude = user?.location?.coordinates?.[1];
    const userLongitude = user?.location?.coordinates?.[0];
    if (typeof userLatitude !== 'number' || typeof userLongitude !== 'number') {
      return false;
    }
    return getDistance(latitude, longitude, userLatitude, userLongitude) <= radiusKm;
  });
}

module.exports = {
  getDistance,
  isBloodGroupCompatible,
  calculateScore,
  filterUsersWithinRadius
};
