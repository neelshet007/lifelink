'use client';

const STORAGE_KEY = 'lifelink-socket-store';
const listeners = new Set();

// Mutable backing state
const state = {
  connectionStatus: 'offline',
  session: null,
  activeEmergency: null,
  activeAlerts: [],
  meshAlerts: [],        // incoming GLOBAL_EMERGENCY_DATA for all roles
  requestConfirmed: null, // REQUEST_CONFIRMED payload
  emergencyDrawerOpen: false,
  navigationMode: false,
  dashboardPulseToken: 0,
};

// ─── CRITICAL FIX ────────────────────────────────────────────────────────────
// useSyncExternalStore compares snapshots by reference equality.
// Returning the same mutable `state` object every call means React can never
// detect a change and will skip re-renders (ghost notification bug).
// We maintain a separate `snapshot` that is replaced with a shallow-copy on
// every emit() call, giving React a new reference to compare against.
// ─────────────────────────────────────────────────────────────────────────────
let snapshot = { ...state };

function emit() {
  snapshot = { ...state }; // new reference on every state change
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    session: state.session,
    activeEmergency: state.activeEmergency,
    activeAlerts: state.activeAlerts,
    meshAlerts: state.meshAlerts.slice(0, 10),
    emergencyDrawerOpen: state.emergencyDrawerOpen,
    navigationMode: state.navigationMode,
  }));
}

// ─── HYDRATION AT MODULE LOAD ─────────────────────────────────────────────────
// Hydrate from localStorage synchronously when this module is first imported.
// This ensures emergency state is ready on the very first render — calling
// hydrateSocketStore() inside a useEffect is too late (runs after first paint).
// ─────────────────────────────────────────────────────────────────────────────
function hydrateNow() {
  if (typeof window === 'undefined') return;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return;

  try {
    const parsed = JSON.parse(stored);
    state.session = parsed.session || null;
    state.activeEmergency = parsed.activeEmergency || null;
    state.activeAlerts = Array.isArray(parsed.activeAlerts) ? parsed.activeAlerts : [];
    state.meshAlerts = Array.isArray(parsed.meshAlerts) ? parsed.meshAlerts : [];
    state.emergencyDrawerOpen = parsed.emergencyDrawerOpen !== false && Boolean(parsed.activeEmergency);
    state.navigationMode = parsed.navigationMode === true && Boolean(parsed.activeEmergency);
    snapshot = { ...state }; // sync snapshot immediately — no emit needed
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Run once synchronously on module import
hydrateNow();

export function socketStoreSubscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSocketStoreState() {
  return snapshot;
}

// ── Kept for backward compatibility (LocationSyncProvider calls this) ──────────
export function hydrateSocketStore() {
  hydrateNow();
  emit(); // notify already-mounted subscribers
}

export function setConnectionStatus(connectionStatus) {
  state.connectionStatus = connectionStatus;
  emit();
}

export function setRealtimeSession(session) {
  state.session = session || null;
  persist();
  emit();
}

export function setActiveEmergency(activeEmergency, options = {}) {
  state.activeEmergency = activeEmergency;
  state.emergencyDrawerOpen = options.keepDrawerState ? state.emergencyDrawerOpen : Boolean(activeEmergency);
  state.navigationMode = activeEmergency
    ? (typeof options.navigationMode === 'boolean' ? options.navigationMode : false)
    : false;

  if (activeEmergency) {
    const nextAlerts = [activeEmergency, ...state.activeAlerts.filter((alert) => String(alert.requestId) !== String(activeEmergency.requestId))];
    state.activeAlerts = nextAlerts.slice(0, 5);
    state.dashboardPulseToken += 1;
  } else {
    state.activeAlerts = state.activeAlerts.filter((alert) => String(alert.requestId) !== String(options.requestId || ''));
  }

  persist();
  emit();
}

export function patchActiveEmergency(patch, options = {}) {
  if (!state.activeEmergency) return;

  state.activeEmergency = {
    ...state.activeEmergency,
    ...patch,
  };

  if (typeof options.navigationMode === 'boolean') {
    state.navigationMode = options.navigationMode;
  }

  if (typeof options.emergencyDrawerOpen === 'boolean') {
    state.emergencyDrawerOpen = options.emergencyDrawerOpen;
  }

  persist();
  emit();
}

export function clearEmergency(requestId) {
  if (!state.activeEmergency || String(state.activeEmergency.requestId) === String(requestId)) {
    state.activeEmergency = null;
    state.emergencyDrawerOpen = false;
    state.navigationMode = false;
  }
  state.activeAlerts = state.activeAlerts.filter((alert) => String(alert.requestId) !== String(requestId));
  persist();
  emit();
}

export function setEmergencyDrawerOpen(open) {
  state.emergencyDrawerOpen = open;
  persist();
  emit();
}

export function setNavigationMode(open) {
  state.navigationMode = open;
  persist();
  emit();
}

// ── Mesh alert management ─────────────────────────────────────────────────────
export function addMeshAlert(alert) {
  const key = String(alert.requestId);
  // Deduplicate by requestId
  const existing = state.meshAlerts.findIndex(a => String(a.requestId) === key);
  if (existing !== -1) {
    state.meshAlerts[existing] = alert; // refresh
  } else {
    state.meshAlerts = [alert, ...state.meshAlerts].slice(0, 20);
  }
  state.dashboardPulseToken += 1;
  persist();
  emit();
}

export function removeMeshAlert(requestId) {
  state.meshAlerts = state.meshAlerts.filter(a => String(a.requestId) !== String(requestId));
  persist();
  emit();
}

export function setRequestConfirmed(payload) {
  state.requestConfirmed = payload;
  emit();
}

export function clearRequestConfirmed() {
  state.requestConfirmed = null;
  emit();
}

export function resetSocketStore() {
  state.connectionStatus = 'offline';
  state.session = null;
  state.activeEmergency = null;
  state.activeAlerts = [];
  state.meshAlerts = [];
  state.requestConfirmed = null;
  state.emergencyDrawerOpen = false;
  state.navigationMode = false;
  state.dashboardPulseToken = 0;

  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }

  emit();
}
