# LifeLink – Technical Specification & Tech Stack
## Project Overview
LifeLink is a high-performance, real-time health-tech platform designed to bridge the gap between blood donors, hospitals, and blood banks. It utilizes advanced mathematical matching, geolocation tracking, and real-time communication to ensure life-saving blood reaches patients in critical windows.

---

## 🛠 Tech Stack Details

### 1. Backend (Server-Side)
- **Runtime**: Node.js
- **Framework**: Express.js (v5.0+)
- **Database**: MongoDB with Mongoose ODM
- **Real-Time Communication**: Socket.io (v4.8+) for high-frequency updates.
- **Security**: 
  - **Authentication**: JWT (JSON Web Tokens) with multi-role support.
  - **Password Hashing**: Bcryptjs.
  - **Middleware**: Helmet (security headers), CORS (cross-origin resource sharing), Express Rate Limit (DDoS protection).
- **Validation**: Joi for strict schema validation of API requests.

### 2. Frontend (Client-Side)
- **Framework**: Next.js 16 (React 19)
- **Styling**: Tailwind CSS 4 with custom glassmorphism and modern aesthetics.
- **Animations**: Framer Motion 12 for smooth UI transitions and micro-interactions.
- **State Management**: Reactive React hooks and specialized Library/Store modules for Socket state.
- **Icons**: Lucide React.
- **Networking**: Axios for promise-based HTTP requests.

---

## 🏗 System Architecture

### Multi-Role Infrastructure
The platform supports four distinct user roles, each with unique dashboards and permissions:
1. **Donor (User)**: Receives real-time local emergency alerts, manages availability, and tracks donation history.
2. **Hospital**: Creates emergency requests, searches nearby donors, manages an internal donor database (Facility Ledger), and fulfills requests.
3. **Blood Bank**: Manages inventory, fulfills inventory-based requests, and can also broadcast emergencies.
4. **Admin**: Oversees system health and cross-platform analytics.

### Real-Time Flow (Closed-Loop Feedback)
LifeLink implements a "Closed-Loop" feedback system using WebSockets:
1. **Broadcast**: Hospital creates a request → Server calculates matches → Only nearby, compatible, eligible donors receive `INCOMING_EMERGENCY`.
2. **Response**: Donor accepts → Hospital receives `DONOR_ACCEPTED` with donor name and live location data.
3. **Live Tracking**: Donor moves → Server emits `LOCATION_UPDATE` → Hospital map moves in real-time with updated ETA.
4. **Completion**: Hospital marks as Fulfilled → Donor receives `REQUEST_FULFILLED` → 90-day cooldown starts.

---

## 📥 Data Models & Schema

### User Schema (`User.js`)
- **Identity Types**: Supports `LOCAL`, `ABHA` (Ayushman Bharat Health Account), `HFR` (Health Facility Registry), and `DCGI` licenses.
- **Internal Database**: Hospitals maintain an `internalDonorDatabase` (array of sub-documents) to manage "offline" donors with barcode IDs.
- **Inventory**: Blood Banks use a Map-based `inventory` schema for real-time stock counts.
- **Geospatial**: `location` field using MongoDB `2dsphere` index for efficient radius-based querying.

### Request Schema (`Request.js`)
- **Urgency Levels**: `Low`, `Medium`, `High`, `Critical`.
- **Status lifecycle**: `Pending`, `Accepted`, `Blood Assigned`, `Fulfilled`, `Closed`, `Expired`.
- **Match Tracking**: Stores `notifiedDonorCount` and `acceptedBy` arrays for event logging.

---

## 🧠 Smart Matching Algorithm
Unlike basic search, LifeLink uses a mathematical scoring engine (`calculateScore`) to rank donors:

**Formula**:
`Match Score = (0.4 × Distance) + (0.3 × Compatibility) + (0.2 × Availability) + (0.1 × Eligibility)`

### Scoring Breakdown:
- **Distance (40%)**: Calculated via Haversine Formula.
  - < 5km: 1.0 score
  - 5-10km: 0.8
  - 10-20km: 0.6
  - > 20km: 0.3
- **Compatibility (30%)**:
  - Exact match: 1.0
  - Cross-compatible (e.g., O- to A+): 0.7
  - Incompatible: 0.0 (Filtered out)
- **Availability (20%)**: Boolean status check.
- **Eligibility (10%)**: Checks if 90 days have passed since `lastDonationDate`.

---

## 🌐 Real-Time Socket Events

| Event Name | Direction | Payload Details |
| :--- | :--- | :--- |
| `INCOMING_EMERGENCY` | Server → Donor | Hospital location, Blood Group, Distance, ETA, Expiry. |
| `DONOR_ACCEPTED` | Donor → Server | `requestId`, `donorId`, coordinates. |
| `LOCATION_UPDATE` | Donor → Server | Live Lat/Lng coordinates. |
| `DONOR_LIVE_LOCATION` | Server → Hospital | Synchronized movement for the request map. |
| `REQUEST_EXPIRED` | Server → Donor | Removes the notification if no one accepts in 15 mins. |

---

## 📂 Project Directory Structure

```text
lifelink/
├── backend/
│   ├── controllers/   # Request fulfillment & Auth logic
│   ├── models/        # Mongoose schemas (User, Request, Registry)
│   ├── routes/        # API endpoints
│   ├── socket/        # WebSocket server & event handlers
│   ├── utils/         # Haversine & Scoring logic
│   └── validation/   # Joi schemas
└── frontend/
    ├── app/           # Next.js App Router (Dashboards, Auth)
    ├── components/    # UI elements (Maps, Toasts, Modals)
    ├── lib/           # SocketStore, DPI handlers, Session state
    └── data/          # Static assets and mock registries
```

---

## 🛂 Identity & ABDM Integration (Mocked)
The platform includes built-in support for India’s **Ayushman Bharat Digital Mission (ABDM)** via a sandbox simulation:
- **ABHA Sync**: Users can sync their profile via `abhaAddress`.
- **Facility Verification**: Hospitals are assigned `Facility-Verified` tiers based on HFR Registry lookups.
- **Mock Registry**: `MockSandboxRegistry.js` simulates a national health database for resolving blood groups and verification badges.
