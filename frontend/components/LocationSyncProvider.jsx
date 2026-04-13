'use client';

import { useEffect, useRef } from 'react';
import { getRealtimeSocket } from '../lib/realtime';
import { getStoredUser } from '../lib/session';
import {
  addMeshAlert,
  clearEmergency,
  getSocketStoreState,
  removeMeshAlert,
  setActiveEmergency,
  setConnectionStatus,
  setRealtimeSession,
  setRequestConfirmed,
} from '../lib/socketStore';

const LOCATION_EMIT_INTERVAL_MS = 5000;

function getSavedCoordinates(user) {
  const latitude = Number(user?.location?.coordinates?.[1]);
  const longitude = Number(user?.location?.coordinates?.[0]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function createMapLink(coords) {
  const lat = Number(coords?.latitude);
  const lng = Number(coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function playEmergencySound() {
  if (typeof window === 'undefined') return;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    const context = new AudioContextCtor();
    [0, 0.18, 0.36].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = index % 2 === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + 0.16);
    });
    setTimeout(() => context.close().catch(() => {}), 900);
  } catch {}
}

function notifyBrowser(title, body, tag) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag, requireInteraction: true });
  } catch {}
}

export default function LocationSyncProvider() {
  const lastNavEmitRef = useRef(0);

  useEffect(() => {
    const user = getStoredUser();
    const userId = user?._id || user?.id;
    if (!userId) return undefined;

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const socket = getRealtimeSocket();
    let latestCoords = getSavedCoordinates(user);

    const initSession = () => {
      socket.emit('init_session', {
        userId,
        latitude: latestCoords?.latitude,
        longitude: latestCoords?.longitude,
      });
    };

    const onConnect = () => {
      setConnectionStatus('online');
      initSession();
    };

    const onDisconnect = () => setConnectionStatus('offline');
    const onSessionReady = (session) => { setRealtimeSession(session); setConnectionStatus('online'); };
    const onSessionError = () => setConnectionStatus('offline');

    // ── GLOBAL EMERGENCY DATA — fires for ALL roles ───────────────────────────
    // Incoming alert from another entity. Stored in meshAlerts[] only.
    // NEVER written to activeEmergency — that field is exclusively for the
    // logged-in user's own outbound request so the header name never changes.
    const onGlobalEmergency = (payload) => {
      const normalised = {
        ...payload,
        requestId: payload.requestId,
        senderName: payload.senderName,        // the SENDER's name (not ours)
        senderType: payload.senderType,
        hospital: payload.senderName,           // alias for legacy UI parts
        hospitalType: payload.senderType,
        hospitalCoords: payload.senderCoords,
        mapLink: createMapLink(payload.senderCoords),
        responseStatus: 'pending',
        message:
          payload.message ||
          `${payload.senderType} (${payload.senderName}) needs ${payload.bloodGroup} — ${payload.distance ?? payload.distanceKm} km away`,
      };

      // Only add to mesh feed — do NOT call setActiveEmergency here.
      addMeshAlert(normalised);
      playEmergencySound();
      notifyBrowser(
        'LifeLink Mesh Alert',
        `${payload.senderName} (${payload.senderType}) needs ${payload.bloodGroup} — ${payload.distance ?? payload.distanceKm} km away`,
        `mesh-${payload.requestId}`
      );
    };

    // ── INCOMING_EMERGENCY — legacy alias for User EmergencyActionDock ────────
    const onIncomingEmergency = (payload) => {
      const emergency = {
        ...payload,
        hospitalType: payload.hospitalType || payload.requesterRole || payload.senderType || 'Hospital',
        mapLink: payload.mapLink || createMapLink(payload.hospitalCoords || payload.senderCoords),
        responseStatus: 'pending',
      };
      if (user.role === 'User') {
        setActiveEmergency(emergency, { navigationMode: false });
        playEmergencySound();
        notifyBrowser(
          'LifeLink Emergency Alert',
          `${emergency.hospital} needs ${emergency.bloodGroup}. ${Number.isFinite(Number(emergency.distanceKm)) ? `${Number(emergency.distanceKm).toFixed(1)} km away` : 'nearby now'}.`,
          `emergency-${emergency.requestId}`
        );
      }
    };

    // ── REQUEST_CONFIRMED — original requester gets this when someone responds ──
    const onRequestConfirmed = (payload) => {
      setRequestConfirmed(payload);
    };

    // ── INCOMING_REQUEST — from REST-triggered broadcasts (facility dashboards) ─
    const onIncomingRequest = (payload) => {
      // Treat exactly like GLOBAL_EMERGENCY_DATA
      onGlobalEmergency({ ...payload, senderName: payload.senderName, senderType: payload.senderType });
    };

    const onRequestExpired = (payload) => {
      clearEmergency(payload?.requestId);
      removeMeshAlert(payload?.requestId);
    };

    const onRequestFulfilled = (payload) => {
      clearEmergency(payload?.requestId);
      removeMeshAlert(payload?.requestId);
    };

    setConnectionStatus(socket.connected ? 'online' : 'connecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('session_ready', onSessionReady);
    socket.on('session_error', onSessionError);
    socket.on('GLOBAL_EMERGENCY_DATA', onGlobalEmergency);
    socket.on('INCOMING_EMERGENCY', onIncomingEmergency);
    socket.on('INCOMING_REQUEST', onIncomingRequest);
    socket.on('REQUEST_CONFIRMED', onRequestConfirmed);
    socket.on('NOTIFY_REQUESTER', onRequestConfirmed);   // alias
    socket.on('REQUEST_EXPIRED', onRequestExpired);
    socket.on('REQUEST_FULFILLED', onRequestFulfilled);

    if (socket.connected) onConnect();

    if (!navigator.geolocation) {
      return () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('session_ready', onSessionReady);
        socket.off('session_error', onSessionError);
        socket.off('GLOBAL_EMERGENCY_DATA', onGlobalEmergency);
        socket.off('INCOMING_EMERGENCY', onIncomingEmergency);
        socket.off('INCOMING_REQUEST', onIncomingRequest);
        socket.off('REQUEST_CONFIRMED', onRequestConfirmed);
        socket.off('NOTIFY_REQUESTER', onRequestConfirmed);
        socket.off('REQUEST_EXPIRED', onRequestExpired);
        socket.off('REQUEST_FULFILLED', onRequestFulfilled);
      };
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        latestCoords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        socket.emit('update_location', latestCoords);

        const { activeEmergency, navigationMode } = getSocketStoreState();
        if (user.role === 'User' && navigationMode && activeEmergency?.requestId) {
          const now = Date.now();
          if (now - lastNavEmitRef.current >= LOCATION_EMIT_INTERVAL_MS) {
            lastNavEmitRef.current = now;
            socket.emit('LOCATION_UPDATE', {
              requestId: activeEmergency.requestId,
              donorId: userId,
              coordinates: latestCoords,
            });
          }
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('session_ready', onSessionReady);
      socket.off('session_error', onSessionError);
      socket.off('GLOBAL_EMERGENCY_DATA', onGlobalEmergency);
      socket.off('INCOMING_EMERGENCY', onIncomingEmergency);
      socket.off('INCOMING_REQUEST', onIncomingRequest);
      socket.off('REQUEST_CONFIRMED', onRequestConfirmed);
      socket.off('NOTIFY_REQUESTER', onRequestConfirmed);
      socket.off('REQUEST_EXPIRED', onRequestExpired);
      socket.off('REQUEST_FULFILLED', onRequestFulfilled);
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return null;
}
