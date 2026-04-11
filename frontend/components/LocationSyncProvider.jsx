'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, MapPin } from 'lucide-react';
import { getRealtimeSocket } from '../lib/realtime';
import { API_URL, getStoredUser, getToken, setStoredUser } from '../lib/session';
import { restoreActiveEmergency, setActiveEmergency } from '../lib/activeEmergencyStore';

function triggerEmergencyPing() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  [0, 0.3, 0.6].forEach((offset) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(880, context.currentTime + offset);
    gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime + offset);
    oscillator.stop(context.currentTime + offset + 0.25);
  });
}

export default function LocationSyncProvider() {
  const [locationDenied, setLocationDenied] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    const token = getToken();
    if (!user?._id || !token) return undefined;

    restoreActiveEmergency();
    const socket = getRealtimeSocket();

    const persistAndInit = async (latitude, longitude) => {
      try {
        const res = await axios.patch(`${API_URL}/api/auth/location`, { latitude, longitude }, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.data?.user) {
          setStoredUser(res.data.user);
        }
      } catch {
      }

      socket.emit('init_session', {
        userId: user._id,
        latitude,
        longitude,
      });
    };

    const requestInitialLocation = () => {
      if (!navigator.geolocation) {
        setLocationDenied(true);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setLocationDenied(false);
          persistAndInit(coords.latitude, coords.longitude);
        },
        () => {
          setLocationDenied(true);
          socket.emit('join', user._id);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    };

    const onIncomingEmergency = (payload) => {
      setActiveEmergency(payload);
      triggerEmergencyPing();
    };

    const clearIfMatches = (payload) => {
      const current = sessionStorage.getItem('lifelink-active-emergency');
      if (!current) return;
      const parsed = JSON.parse(current);
      if (String(parsed.requestId) === String(payload.requestId)) {
        setActiveEmergency(null);
      }
    };

    socket.on('connect', requestInitialLocation);
    socket.on('INCOMING_EMERGENCY', onIncomingEmergency);
    socket.on('REQUEST_EXPIRED', clearIfMatches);
    socket.on('REQUEST_FULFILLED', clearIfMatches);

    requestInitialLocation();

    let watchId;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          setLocationDenied(false);
          socket.emit('update_coords', { lat: coords.latitude, lng: coords.longitude });
          socket.emit('update_location', { latitude: coords.latitude, longitude: coords.longitude });
        },
        () => setLocationDenied(true),
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
      );
    }

    return () => {
      socket.off('connect', requestInitialLocation);
      socket.off('INCOMING_EMERGENCY', onIncomingEmergency);
      socket.off('REQUEST_EXPIRED', clearIfMatches);
      socket.off('REQUEST_FULFILLED', clearIfMatches);
      if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  if (!locationDenied) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/82 p-6 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] border border-red-400/30 bg-[linear-gradient(180deg,rgba(69,10,10,0.96),rgba(15,23,42,0.96))] p-8 text-white shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3 text-red-300">
          <AlertTriangle className="h-8 w-8" />
          <p className="text-xs font-semibold uppercase tracking-[0.28em]">Location Required</p>
        </div>
        <h2 className="mt-4 text-3xl font-semibold">Emergency Matching Disabled. Please enable location to save lives.</h2>
        <p className="mt-4 text-sm leading-6 text-slate-200">
          LifeLink needs your live coordinates to calculate the 5 km point-to-point emergency radius in real time.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 inline-flex items-center gap-2 rounded-[1rem] bg-red-500 px-5 py-3 text-sm font-semibold text-white hover:bg-red-400"
        >
          <MapPin className="h-4 w-4" />
          Retry Location Access
        </button>
      </div>
    </div>
  );
}
