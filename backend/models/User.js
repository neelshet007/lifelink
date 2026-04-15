/**
 * ============================================================
 * FILE: backend/models/User.js
 * ROLE: Mongoose Schema & Model for every user in LifeLink
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * This schema represents ALL actors in the system under a single
 * collection. The `role` field differentiates them:
 *
 *   'User'       → blood donor / citizen (ABHA identity)
 *   'Hospital'   → blood-requesting hospital (HFR identity)
 *   'Blood Bank' → blood-supplying facility (DCGI identity)
 *   'Admin'      → platform admin
 *
 * Where does data come from?
 * --------------------------
 * 1. LOCAL registration (role=User/Hospital/Blood Bank):
 *    Data arrives from req.body in authController.registerUser().
 *
 * 2. ABDM Gateway / ABHA login:
 *    Name, DOB, gender, bloodGroup are pulled from MockSandboxRegistry
 *    (which mirrors the ABDM Sandbox) via authController.completeGatewayLogin().
 *
 * 3. Facility onboarding (Hospital / Blood Bank):
 *    Fields like hfrFacilityId, dcgiLicenseNumber, facilityType, etc. come
 *    from MockFacilitiesRegistry via authController.registerFacilityOnboarding().
 *
 * 4. Real-time location sync:
 *    The `location` field (GeoJSON Point) is updated:
 *      a) On every socket `init_session` / `update_coords` event
 *         in socket/index.js → upsertSession()
 *      b) Via the REST PATCH /api/auth/location endpoint
 *         in authController.updateCurrentLocation()
 *
 * WHY GeoJSON + 2dsphere?
 * -----------------------
 * MongoDB's $near / $geoWithin operators require a 2dsphere index on the
 * location field. We store coordinates as [longitude, latitude] (GeoJSON
 * standard). The matchingAlgorithm.getDistance() function uses Haversine
 * math on these values to compute km distances for every nearby query.
 *
 * WHY internalDonorDatabase?
 * --------------------------
 * Hospitals manage walk-in donors who are NOT registered on the LifeLink
 * platform. These donors are stored as sub-documents inside the hospital's
 * own User document so they are only visible to that hospital and can be
 * searched in requestController.getRequestMatches().
 *
 * WHY inventory (Map)?
 * --------------------
 * Blood banks track blood-group stock as a Map<bloodGroup, unitCount>.
 * Using a Mongoose Map means we can store arbitrary blood-group keys
 * (A+, B-, O+, etc.) without defining a fixed schema.
 */

const mongoose = require('mongoose');

/**
 * internalDonorSchema — sub-document for walk-in / offline donors.
 *
 * These donors are NOT platform users. They have a barcodeId (physical
 * card at the hospital) and a contact number instead of an ABHA address.
 * The hospital controller (hospitalController.js) reads and writes these
 * sub-documents. The matching algorithm scores them the same way as
 * platform users.
 */
const internalDonorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: true
  },
  contact: { type: String, required: true },
  barcodeId: { type: String, required: true },   // physical scan ID on hospital card
  donationHistory: { type: String, default: '' }, // free-text notes
  donation_history: [{ type: Date }],             // machine-readable dates for scoring
  lastDonationDate: { type: Date },               // used to enforce 90-day cooldown
  isAvailable: { type: Boolean, default: true },
  is_eligible: { type: Boolean, default: true }
});

/**
 * userSchema — the main document schema.
 *
 * Fields are grouped by concern:
 *   - Core identity (name, email, password, role)
 *   - ABDM / HFR / DCGI verification fields
 *   - Donor-specific fields (bloodGroup, donation history)
 *   - Location (GeoJSON + 2dsphere index)
 *   - Facility-specific fields (inventory, facilityAddress, etc.)
 */
const userSchema = new mongoose.Schema({
  // ── Core identity ─────────────────────────────────────────────────────────────
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  contact: { type: String },
  age: { type: Number },
  password: { type: String, required: true },

  // role determines which dashboard, routes, and socket behaviors apply.
  role: {
    type: String,
    enum: ['User', 'Hospital', 'Blood Bank', 'Admin'],
    required: true
  },

  // ── ABDM / HFR / DCGI identity ────────────────────────────────────────────────
  // identityType tells the system which identity provider was used:
  //   ABHA  → citizen (National Health Authority)
  //   HFR   → hospital (Health Facility Registry)
  //   DCGI  → blood bank (Drug Controller General of India)
  //   LOCAL → plain email/password registration (no government identity)
  identityType: {
    type: String,
    enum: ['ABHA', 'HFR', 'DCGI', 'LOCAL'],
    default: 'LOCAL'
  },

  // Each identifier is unique but sparse (null for other identity types).
  abhaAddress: { type: String, unique: true, sparse: true, trim: true },
  hfrFacilityId: { type: String, unique: true, sparse: true, trim: true },
  dcgiLicenseNumber: { type: String, unique: true, sparse: true, trim: true },

  // ── Donor fields ──────────────────────────────────────────────────────────────
  // bloodGroup is empty for facilities and LOCAL users who haven't verified.
  // It is read by requestController.resolveUserBloodGroup() which may fall back
  // to MockSandboxRegistry for ABHA users who recently updated their profile.
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''],
    default: ''
  },

  // donorFeaturesEnabled=false hides the donor UI for hospitals/blood banks
  // and for citizens who haven't provided their blood group yet.
  donorFeaturesEnabled: { type: Boolean, default: true },
  nhcxConsent: { type: Boolean, default: false }, // NHA data-sharing consent

  // ── Verification & facility metadata ─────────────────────────────────────────
  // Set by the gateway / onboarding flow, displayed as trust badges in the UI.
  verificationBadge: { type: String, default: '' },
  verificationSource: { type: String, default: '' },
  facilityAddress: { type: String, default: '' },
  facilityType: { type: String, default: '' },
  licenseStatus: { type: String, default: '' },
  license_type: { type: String, default: '' },
  verificationTier: { type: String, default: 'Facility-Verified' },
  verificationSourceId: { type: String, default: '' }, // HFR/DCGI ID submitted during profile completion
  lastAbdmSyncAt: { type: Date }, // timestamp of last ABDM registry sync

  // ── Location (GeoJSON) ────────────────────────────────────────────────────────
  // Stored as [longitude, latitude] — GeoJSON convention.
  // Updated: (a) on register, (b) via PATCH /api/auth/location, (c) via socket.
  // Used by: requestController (proximity filter) and socket/index (mesh broadcast).
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },

  // ── Donation history ──────────────────────────────────────────────────────────
  // Used to enforce the 90-day cooldown between donations.
  // assignDonor() sets lastDonationDate=now and is_eligible=false when a donor
  // is assigned. The scheduler (if added later) would reset is_eligible to true
  // after 90 days.
  lastDonationDate: { type: Date },
  donation_history: [{ type: Date }],
  isAvailable: { type: Boolean, default: true },
  is_eligible: { type: Boolean, default: true },

  // ── Hospital-owned sub-collections ────────────────────────────────────────────
  // internalDonorDatabase — walk-in donors not on the platform.
  // inventory — blood-unit stock (Map: bloodGroup → count), used by ALLOCATE_FROM_STOCK socket event.
  internalDonorDatabase: [internalDonorSchema],
  inventory: {
    type: Map,
    of: Number,
    default: {}
  }
}, { timestamps: true }); // createdAt/updatedAt added automatically

// Enable geospatial queries ($near, $geoWithin) on the location field.
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
