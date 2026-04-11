'use client';

import { useEffect } from 'react';
import { getRealtimeSocket } from '../lib/realtime';
import { getStoredUser } from '../lib/session';
import {
  clearEmergency,
  getSocketStoreState,
  hydrateSocketStore,
  setActiveEmergency,
  setConnectionStatus,
  setRealtimeSession,
} from '../lib/socketStore';

function getSavedCoordinates(user) {
  const latitude = Number(user?.location?.coordinates?.[1]);
  const longitude = Number(user?.location?.coordinates?.[0]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function createMapLink(hospitalCoords) {
  const latitude = Number(hospitalCoords?.latitude);
  const longitude = Number(hospitalCoords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function playEmergencySound() {
  if (typeof window === 'undefined') return;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    const context = new AudioContextCtor();
    const sequence = [0, 0.18, 0.36];

    sequence.forEach((offset, index) => {
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

    setTimeout(() => {
      context.close().catch(() => {});
    }, 900);
  } catch {}
}

function notifyEmergency(payload) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const distanceLabel = Number.isFinite(Number(payload.distanceKm))
    ? `${Number(payload.distanceKm).toFixed(1)} km away`
    : 'nearby now';

  try {
    new Notification('LifeLink Emergency Alert', {
      body: `${payload.hospital} needs ${payload.bloodGroup}. ${distanceLabel}.`,
      tag: `emergency-${payload.requestId}`,
      requireInteraction: true,
    });
  } catch {}
}

function normalizeIncomingEmergency(payload) {
  return {
    ...payload,
    hospitalType: payload.hospitalType || payload.requesterRole || 'Hospital',
    mapLink: payload.mapLink || createMapLink(payload.hospitalCoords),
    responseStatus: 'pending',
  };
}

export default function LocationSyncProvider() {
  useEffect(() => {
    hydrateSocketStore();

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

    const onDisconnect = () => {
      setConnectionStatus('offline');
    };

    const onSessionReady = (session) => {
      setRealtimeSession(session);
      setConnectionStatus('online');
    };

    const onSessionError = () => {
      setConnectionStatus('offline');
    };

    const onIncomingEmergency = (payload) => {
      const emergency = normalizeIncomingEmergency(payload);
      setActiveEmergency(emergency, { navigationMode: false });
      notifyEmergency(emergency);
      playEmergencySound();
    };

    const onRequestExpired = (payload) => {
      clearEmergency(payload?.requestId);
    };

    const onRequestFulfilled = (payload) => {
      clearEmergency(payload?.requestId);
    };

    setConnectionStatus(socket.connected ? 'online' : 'connecting');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('session_ready', onSessionReady);
    socket.on('session_error', onSessionError);
    socket.on('INCOMING_EMERGENCY', onIncomingEmergency);
    socket.on('REQUEST_EXPIRED', onRequestExpired);
    socket.on('REQUEST_FULFILLED', onRequestFulfilled);

    if (socket.connected) {
      onConnect();
    }

    if (!navigator.geolocation) {
      return () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('session_ready', onSessionReady);
        socket.off('session_error', onSessionError);
        socket.off('INCOMING_EMERGENCY', onIncomingEmergency);
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
          socket.emit('LOCATION_UPDATE', {
            requestId: activeEmergency.requestId,
            donorId: userId,
            coordinates: latestCoords,
          });
        }
      },
      () => {},
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 15000,
      }
    );

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('session_ready', onSessionReady);
      socket.off('session_error', onSessionError);
      socket.off('INCOMING_EMERGENCY', onIncomingEmergency);
      socket.off('REQUEST_EXPIRED', onRequestExpired);
      socket.off('REQUEST_FULFILLED', onRequestFulfilled);
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return null;
}
