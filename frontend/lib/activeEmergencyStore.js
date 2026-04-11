'use client';

const listeners = new Set();

const state = {
  activeEmergency: null,
  emergencyDrawerOpen: false,
};

function emit() {
  listeners.forEach((listener) => listener());
}

export function activeEmergencyStoreSubscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveEmergencyState() {
  return state;
}

export function setActiveEmergency(emergency) {
  state.activeEmergency = emergency;
  state.emergencyDrawerOpen = Boolean(emergency);

  if (typeof window !== 'undefined') {
    if (emergency) {
      sessionStorage.setItem('lifelink-active-emergency', JSON.stringify(emergency));
    } else {
      sessionStorage.removeItem('lifelink-active-emergency');
    }
  }

  emit();
}

export function restoreActiveEmergency() {
  if (typeof window === 'undefined') return;
  const stored = sessionStorage.getItem('lifelink-active-emergency');
  if (!stored) return;

  try {
    const parsed = JSON.parse(stored);
    state.activeEmergency = parsed;
    state.emergencyDrawerOpen = true;
    emit();
  } catch {
    sessionStorage.removeItem('lifelink-active-emergency');
  }
}

export function setEmergencyDrawerOpen(open) {
  state.emergencyDrawerOpen = open;
  emit();
}
