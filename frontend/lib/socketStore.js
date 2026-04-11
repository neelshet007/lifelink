'use client';

const STORAGE_KEY = 'lifelink-socket-store';
const listeners = new Set();

const state = {
  connectionStatus: 'offline',
  session: null,
  activeEmergency: null,
  activeAlerts: [],
  emergencyDrawerOpen: false,
  navigationMode: false,
  dashboardPulseToken: 0,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    session: state.session,
    activeEmergency: state.activeEmergency,
    activeAlerts: state.activeAlerts,
    emergencyDrawerOpen: state.emergencyDrawerOpen,
    navigationMode: state.navigationMode,
  }));
}

export function socketStoreSubscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSocketStoreState() {
  return state;
}

export function hydrateSocketStore() {
  if (typeof window === 'undefined') return;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return;

  try {
    const parsed = JSON.parse(stored);
    state.session = parsed.session || null;
    state.activeEmergency = parsed.activeEmergency || null;
    state.activeAlerts = Array.isArray(parsed.activeAlerts) ? parsed.activeAlerts : [];
    state.emergencyDrawerOpen = parsed.emergencyDrawerOpen !== false && Boolean(parsed.activeEmergency);
    state.navigationMode = parsed.navigationMode === true && Boolean(parsed.activeEmergency);
    emit();
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
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

export function resetSocketStore() {
  state.connectionStatus = 'offline';
  state.session = null;
  state.activeEmergency = null;
  state.activeAlerts = [];
  state.emergencyDrawerOpen = false;
  state.navigationMode = false;
  state.dashboardPulseToken = 0;

  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }

  emit();
}
