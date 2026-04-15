/**
 * ============================================================
 * FILE: backend/utils/matchingAlgorithm.js
 * ROLE: Pure math utilities for donor-request matching
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * This module has NO side effects — it exports pure functions used by:
 *
 *   requestController.js
 *     - getDistance()           → filter donors/requests within radius
 *     - isBloodGroupCompatible() → blood-group gate before adding to results
 *     - calculateScore()         → rank matched donors
 *
 *   socket/index.js
 *     - getDistance()           → compute km between sender and each session
 *                                  to decide who gets a mesh alert broadcast
 *
 * All inputs are plain numbers / strings. No DB access is performed here.
 *
 * MATCHING SCORE FORMULA
 * ──────────────────────
 * Score = 0.4 × distanceScore
 *       + 0.3 × compatibilityScore
 *       + 0.2 × availabilityScore
 *       + 0.1 × eligibilityScore
 *
 * Weights rationale:
 *   - Distance (40%) — the most critical factor in emergency response
 *   - Blood compatibility (30%) — exact match beats compatible (e.g. O- donor)
 *   - Availability (20%) — donor must not be off duty
 *   - Eligibility (10%) — donor must be past the 90-day cooldown
 *
 * BLOOD GROUP COMPATIBILITY RULES
 * ────────────────────────────────
 * O- donor → can donate to anyone (universal donor)
 * AB+ recipient → can receive from anyone (universal recipient)
 * Same base type (A/B/O/AB): negative can donate to positive of same type
 *
 * Example: A- donor can give to A+ recipient (same base "A", negative to positive allowed)
 * Example: A+ donor CANNOT give to A- recipient (positive to negative forbidden)
 */

/**
 * getDistance(lat1, lon1, lat2, lon2) → kilometers
 *
 * Uses the Haversine formula which accounts for Earth's spherical geometry.
 * More accurate than simple Euclidean (Pythagorean) distance for coordinates.
 *
 * Used in:
 *   - createRequest: to decide who gets a mesh alert
 *   - getIncomingRequests: 5 km donor filter
 *   - getExternalRequirements: 10 km facility filter
 *   - getRequestMatches: ranking donors by distance from the request location
 *   - socket meshBroadcast: per-session radius check
 *   - socket emitDonorAccepted: compute ETA (distanceKm × 4 minutes/km)
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);  
  const dLon = (lon2 - lon1) * (Math.PI / 180); 
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c; 
}

/**
 * isBloodGroupCompatible(donorBloodGroup, requestedBloodGroup) → boolean
 *
 * Returns true if the donor's blood can be given to a patient with requestedBloodGroup.
 *
 * Rules (simplified for current implementation):
 *   1. Exact match → always compatible
 *   2. O- donor   → universal donor, compatible with everyone
 *   3. AB+ patient → universal recipient, compatible with everyone
 *   4. Same base (e.g. A- donor, A+ patient) → allowed (negative → positive only)
 *
 * Used in:
 *   - getIncomingRequests: filters the donor's view of incoming requests
 *   - getRequestMatches: pre-filter before calculateScore
 *   - socket meshBroadcast: skip incompatible users during mesh alert delivery
 */
function isBloodGroupCompatible(donorBloodGroup, requestedBloodGroup) {
  if (!donorBloodGroup || !requestedBloodGroup) return false;
  if (donorBloodGroup === requestedBloodGroup) return true;
  if (donorBloodGroup === 'O-') return true;      // universal donor
  if (requestedBloodGroup === 'AB+') return true; // universal recipient

  // Helper functions for ABO type and Rh factor
  const base = (bg) => String(bg).replace('+', '').replace('-', ''); // "A", "B", "AB", "O"
  const isPositive = (bg) => String(bg).includes('+');

  // Same ABO type AND donor is negative, patient is positive → compatible
  return base(donorBloodGroup) === base(requestedBloodGroup)
    && isPositive(requestedBloodGroup)
    && !isPositive(donorBloodGroup);
}

/**
 * calculateScore(distance, bloodCompatibility, isAvailable, lastDonationDaysAgo) → 0–1
 *
 * Computes a composite matching score for ranking donor candidates.
 * Higher score = better match should appear first in the list.
 *
 * Used by getRequestMatches() to sort the merged list of internal + platform donors.
 *
 * @param {number}      distance          - km between donor and request location
 * @param {string}      bloodCompatibility - 'Exact' | 'Compatible' | 'Not compatible'
 * @param {boolean}     isAvailable        - false if donor has marked themselves unavailable
 * @param {number|null} lastDonationDaysAgo - days since last donation (null = never donated)
 * @returns {number} scoring between 0 and 1 (higher is better)
 */
function calculateScore(distance, bloodCompatibility, isAvailable, lastDonationDaysAgo) {
  // Distance Score (40% weight)
  // Closer donors score higher; >20 km gets a low floor of 0.3
  let distanceScore = 0;
  if (distance < 5) distanceScore = 1;
  else if (distance <= 10) distanceScore = 0.8;
  else if (distance <= 20) distanceScore = 0.6;
  else distanceScore = 0.3;

  // Compatibility Score (30% weight)
  // Exact match (same group) is preferred over compatible (partial match)
  let compScore = 0;
  if (bloodCompatibility === 'Exact') compScore = 1;
  else if (bloodCompatibility === 'Compatible') compScore = 0.7;
  else compScore = 0;

  // Availability Score (20% weight)
  // Donors who are currently available get full credit
  const availabilityScore = isAvailable ? 1 : 0;

  // Eligibility Score (10% weight)
  // null means never donated → fully eligible.
  // >= 90 days → eligible again after cooldown period.
  const eligibilityScore = (lastDonationDaysAgo === null || lastDonationDaysAgo >= 90) ? 1 : 0;

  return (0.4 * distanceScore) + (0.3 * compScore) + (0.2 * availabilityScore) + (0.1 * eligibilityScore);
}

/**
 * filterUsersWithinRadius(users, latitude, longitude, radiusKm) → User[]
 *
 * Convenience wrapper that takes a list of User documents and returns only
 * those whose stored location is within radiusKm of (latitude, longitude).
 *
 * Currently exported but not used internally — available for future features
 * like batch proximity checks outside of controller/socket code.
 */
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
