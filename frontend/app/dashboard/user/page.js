'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Droplet,
  LockKeyhole,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Siren,
  X,
} from 'lucide-react';
import { useDpi } from '../../../components/providers/DpiProvider';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';

function subscribe() { return () => {}; }
const ACTIVE_EMERGENCY_STORAGE_KEY = 'lifelink-active-emergency';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function parseEligibility(bundle, abhaId) {
  const entries = bundle?.entry || [];
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  for (const entry of entries) {
    const resource = entry.resource;
    if (resource?.subject?.identifier?.value !== abhaId) continue;
    if (resource.resourceType === 'Observation') {
      const testName = resource.code?.text?.toLowerCase() || '';
      const result = String(resource.valueString || '').toLowerCase();
      if (testName.includes('malaria') && result.includes('positive')) {
        return { eligible: false, reason: 'Malaria: Positive detected in the last 90-day FHIR bundle.' };
      }
    }
    if (resource.resourceType === 'Procedure') {
      const procedureName = resource.code?.text?.toLowerCase() || '';
      const performedDate = resource.performedDateTime ? new Date(resource.performedDateTime) : null;
      if (procedureName.includes('blood donation') && performedDate && performedDate >= cutoff) {
        return { eligible: false, reason: 'Blood donation already recorded within the last 90 days.' };
      }
    }
  }
  return { eligible: true };
}

function triggerEmergencyPing() {
  if (typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  // Play three urgent pings like an emergency alert
  const audioContext = new AudioContextClass();
  [0, 0.35, 0.7].forEach((offset) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime + offset);
    oscillator.frequency.setValueAtTime(660, audioContext.currentTime + offset + 0.15);
    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime + offset);
    gainNode.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + offset + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + offset + 0.3);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(audioContext.currentTime + offset);
    oscillator.stop(audioContext.currentTime + offset + 0.35);
  });
}

function triggerBrowserNotification(payload, onClickCallback) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  const show = () => {
    const notification = new Notification('🚨 LifeLink Red Alert', {
      body: payload.message,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      requireInteraction: true, // stays until user dismisses
      tag: 'lifelink-emergency', // replaces previous notification
    });
    notification.onclick = () => {
      window.focus();
      onClickCallback?.();
    };
  };
  if (Notification.permission === 'granted') {
    show();
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') show();
    });
  }
}

// ─── In-App Emergency Toast ───────────────────────────────────────────────────
function EmergencyToast({ alert, onViewTab, onDismiss }) {
  return (
    <motion.div
      key="emergency-toast"
      initial={{ opacity: 0, x: 60, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      className="fixed bottom-6 right-6 z-50 w-full max-w-sm"
    >
      <div className="relative overflow-hidden rounded-[1.4rem] border border-red-400/40 bg-[linear-gradient(135deg,rgba(127,29,29,0.97),rgba(69,10,10,0.95))] shadow-[0_8px_40px_rgba(220,38,38,0.35)] backdrop-blur-xl">
        {/* Animated pulse bar at top */}
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-red-500 via-orange-400 to-red-500 animate-[shimmer_2s_linear_infinite] bg-[length:200%_100%]" />

        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-500/25 ring-2 ring-red-400/40">
              <Siren className="h-5 w-5 text-red-300 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">🚨 Active Emergency</p>
              <p className="mt-1 text-sm font-semibold text-white leading-5 truncate">{alert.hospital}</p>
              <p className="mt-0.5 text-xs text-red-100/80 leading-4">{alert.bloodGroup} needed · {alert.distance} km away</p>
            </div>
            <button
              onClick={onDismiss}
              className="ml-1 flex-shrink-0 rounded-full p-1 text-red-300/70 hover:text-red-200 hover:bg-red-900/40 transition-colors"
              aria-label="Dismiss toast"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={onViewTab}
              className="flex-1 rounded-[0.9rem] bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-400 active:bg-red-600 transition-colors"
            >
              View Emergency Tab
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Active Emergency Panel (full-width dramatic card) ────────────────────────
function ActiveEmergencyPanel({ request, timeLeft, donorLocked, onAccept, onDecline }) {
  const isAccepted = request.accepted;

  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className="lg:col-span-2"
    >
      <div className="relative overflow-hidden rounded-[1.8rem] border-2 border-red-400/50 bg-[linear-gradient(160deg,rgba(127,29,29,0.55),rgba(69,10,10,0.35))] shadow-[0_0_0_1px_rgba(248,113,113,0.18),0_20px_60px_rgba(127,29,29,0.30)] backdrop-blur-sm">
        {/* Animated dashed border overlay */}
        <div className="pointer-events-none absolute inset-0 rounded-[1.8rem] ring-2 ring-red-500/20 animate-pulse" />

        {/* Header stripe */}
        <div className="border-b border-red-400/20 px-7 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/25 ring-2 ring-red-400/40">
                <Siren className="h-6 w-6 text-red-300 animate-pulse" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-red-300">🚨 Active Emergency</p>
                <h2 className="mt-0.5 text-xl font-semibold text-white">{request.hospital}</h2>
              </div>
            </div>

            {/* Countdown Timer */}
            <div className="rounded-[1rem] border border-red-400/30 bg-red-950/40 px-5 py-3 text-center min-w-[110px]">
              <p className="text-[10px] uppercase tracking-[0.2em] text-red-300/80">Expiring in</p>
              <p className={`mt-1 font-mono text-2xl font-bold tabular-nums ${timeLeft === 'Expired' ? 'text-red-500' : 'text-white'}`}>
                {timeLeft || '15:00'}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-7">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.2rem] border border-white/10 bg-white/6 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Blood Group Needed</p>
              <p className="mt-2 text-3xl font-bold text-red-300">{request.bloodGroup}</p>
            </div>
            <div className="rounded-[1.2rem] border border-white/10 bg-white/6 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Distance</p>
              <p className="mt-2 text-3xl font-bold text-white">{request.distance} <span className="text-base font-normal text-slate-400">km</span></p>
            </div>
            <div className="rounded-[1.2rem] border border-white/10 bg-white/6 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Urgency</p>
              <p className="mt-2 text-2xl font-bold text-orange-300">{request.urgency || 'Critical'}</p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-200">{request.message}</p>

          {isAccepted ? (
            <div className="mt-6 rounded-[1.2rem] border border-emerald-400/30 bg-emerald-500/12 px-5 py-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-300" />
              <p className="text-sm font-semibold text-emerald-100">Accepted — ZK proof is being generated. You are on your way.</p>
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                onClick={() => onAccept(request)}
                disabled={donorLocked}
                className="flex-1 min-w-[180px] bg-red-500 text-white hover:bg-red-400 active:bg-red-600 py-6 text-base font-bold"
                id="btn-accept-emergency"
              >
                <CheckCircle2 className="h-5 w-5" />
                ACCEPT REQUEST
              </Button>
              <Button
                variant="secondary"
                onClick={() => onDecline(request)}
                className="bg-white/10 text-white hover:bg-white/15 py-6 px-8 text-base"
                id="btn-decline-emergency"
              >
                DECLINE
              </Button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function UserDashboard() {
  const { abhaPatient, abhaVerified, createProof, proofs, connectAbha } = useDpi();
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const gatewayUser = isClient ? JSON.parse(localStorage.getItem('user') || 'null') : null;
  const token = isClient ? localStorage.getItem('token') : null;
  const socketRef = useRef(null);

  const [selectedAlert, setSelectedAlert] = useState(null);
  const [proofStage, setProofStage] = useState('idle');
  const [eligibilityMessage, setEligibilityMessage] = useState('');
  const [regionalAlerts, setRegionalAlerts] = useState([]);
  const [persistentAlert, setPersistentAlert] = useState(null);
  const [profileModalOpen, setProfileModalOpen] = useState(true);
  const [profileDraft, setProfileDraft] = useState({ bloodGroup: 'O+', verificationSourceId: 'lilavati@hfr' });
  const [requestDraft, setRequestDraft] = useState({ bloodGroup: 'O+', urgency: 'High' });
  const [requestStatus, setRequestStatus] = useState('');
  const [showToast, setShowToast] = useState(false);

  const [activeRequest, setActiveRequest] = useState(() => {
    if (typeof window === 'undefined') return null;
    const stored = sessionStorage.getItem(ACTIVE_EMERGENCY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  });

  const [activeSection, setActiveSection] = useState(() => {
    // If we restored an emergency from sessionStorage, open the emergency section
    if (typeof window === 'undefined') return 'dashboard';
    return sessionStorage.getItem(ACTIVE_EMERGENCY_STORAGE_KEY) ? 'emergency' : 'dashboard';
  });

  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  // ── Socket connection with auto-reconnect ──────────────────────────────────
  useEffect(() => {
    if (!gatewayUser?._id) return;

    const socket = io(API_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    const doJoin = () => {
      socket.emit('join', gatewayUser._id);
      socket.emit('join-region', gatewayUser.currentRegion || 'south-zone');
    };

    doJoin();

    // Push initial GPS immediately so server has coords before any broadcast fires.
    // The watchPosition callback may not have fired yet at join time.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          socket.emit('update_coords', {
            lat: coords.latitude,
            lng: coords.longitude,
            bloodGroup: gatewayUser?.bloodGroup || '',
          });
        },
        () => {}, // silently ignore denial
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }

    // Re-join rooms after any reconnection
    socket.on('connect', () => {
      console.log('[Socket] (Re)connected:', socket.id);
      doJoin();
      // Re-push coords after reconnect too
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            socket.emit('update_coords', {
              lat: coords.latitude,
              lng: coords.longitude,
              bloodGroup: gatewayUser?.bloodGroup || '',
            });
          },
          () => {},
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    });

    socket.on('INCOMING_EMERGENCY', (payload) => {
      setRegionalAlerts((prev) => [payload, ...prev].slice(0, 3));
      setPersistentAlert(payload);
      setActiveRequest(payload);
      setActiveSection('emergency');
      setShowToast(true);
      sessionStorage.setItem(ACTIVE_EMERGENCY_STORAGE_KEY, JSON.stringify(payload));
      triggerEmergencyPing();
      triggerBrowserNotification(payload, () => setActiveSection('emergency'));
    });

    // Auto-clear when request expires on the server
    socket.on('REQUEST_EXPIRED', (payload) => {
      setActiveRequest((prev) => {
        if (!prev || String(prev.requestId) !== String(payload.requestId)) return prev;
        sessionStorage.removeItem(ACTIVE_EMERGENCY_STORAGE_KEY);
        return null;
      });
      setPersistentAlert(null);
      setShowToast(false);
      setRegionalAlerts((prev) => prev.filter((a) => String(a.requestId) !== String(payload.requestId)));
    });

    // Auto-clear when hospital fulfils the request
    socket.on('REQUEST_FULFILLED', (payload) => {
      setActiveRequest((prev) => {
        if (!prev || String(prev.requestId) !== String(payload.requestId)) return prev;
        sessionStorage.removeItem(ACTIVE_EMERGENCY_STORAGE_KEY);
        return null;
      });
      setPersistentAlert(null);
      setShowToast(false);
    });

    socketRef.current = socket;
    return () => socket.disconnect();
  }, [gatewayUser?._id, gatewayUser?.currentRegion]);

  // Request browser notification permission early
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ── Live geolocation → socket ──────────────────────────────────────────────
  useEffect(() => {
    if (!token || !gatewayUser?._id || !navigator.geolocation) return undefined;

    let cancelled = false;
    let lastPersistedAt = 0;

    const persistLocation = async (latitude, longitude) => {
      try {
        const res = await axios.patch(`${API_URL}/api/auth/location`, { latitude, longitude }, {
          headers: { Authorization: `Bearer ${token}` },
        });
        localStorage.setItem('user', JSON.stringify(res.data.user));
      } catch {
        // Best-effort sync
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        if (cancelled) return;
        const { latitude, longitude } = position.coords;

        socketRef.current?.emit('update_coords', {
          lat: latitude,
          lng: longitude,
          bloodGroup: gatewayUser?.bloodGroup || '',
        });

        socketRef.current?.emit('update_location', {
          latitude,
          longitude,
          bloodGroup: gatewayUser?.bloodGroup || '',
        });

        if ((Date.now() - lastPersistedAt) >= 5 * 60 * 1000) {
          lastPersistedAt = Date.now();
          await persistLocation(latitude, longitude);
        }
      },
      () => { /* Ignore denial — keep dashboard usable */ },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 }
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [gatewayUser?._id, gatewayUser?.bloodGroup, token]);

  // ── Countdown tick ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRequest?.expiresAt) return undefined;

    const intervalId = window.setInterval(() => {
      const msRemaining = new Date(activeRequest.expiresAt).getTime() - Date.now();
      if (msRemaining <= 0) {
        setActiveRequest(null);
        setPersistentAlert(null);
        setShowToast(false);
        sessionStorage.removeItem(ACTIVE_EMERGENCY_STORAGE_KEY);
        window.clearInterval(intervalId);
        return;
      }
      setCountdownNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeRequest]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const latestProof = proofs[0];
  // Donor is locked only when we have absolutely no blood group info (neither ABHA nor profile)
  const donorLocked = !abhaPatient?.bloodGroup && !gatewayUser?.bloodGroup;
  const activeAlerts = useMemo(() => regionalAlerts.length > 0 ? regionalAlerts : [], [regionalAlerts]);
  const shouldCompleteProfile = gatewayUser?.identityType === 'ABHA' && !gatewayUser?.bloodGroup;

  const timeLeft = useMemo(() => {
    if (!activeRequest?.expiresAt) return '';
    const msRemaining = new Date(activeRequest.expiresAt).getTime() - countdownNow;
    if (msRemaining <= 0) return 'Expired';
    const minutes = String(Math.floor(msRemaining / 60000)).padStart(2, '0');
    const seconds = String(Math.floor((msRemaining % 60000) / 1000)).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, [activeRequest, countdownNow]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleProfileComplete = async () => {
    const res = await axios.post(`${API_URL}/api/auth/complete-profile`, profileDraft, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    connectAbha(res.data.fhirPatient);
    setProfileModalOpen(false);
  };

  const handleCreateRequest = async () => {
    if (!token) return;
    try {
      const res = await axios.post(`${API_URL}/api/requests`, requestDraft, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequestStatus(`Request created. ${res.data.matches?.length || 0} nearby verified donors were matched.`);
    } catch (error) {
      setRequestStatus(error.response?.data?.message || 'Could not create the blood request.');
    }
  };

  const handleAccept = async (alert) => {
    // 1. ALWAYS emit the socket accept first — this drives the hospital's real-time banner.
    //    Do NOT gate this on abhaPatient being present.
    socketRef.current?.emit('accept_request', { requestId: alert.requestId || alert.id });

    const updated = { ...(activeRequest || alert), accepted: true };
    setActiveRequest(updated);
    setActiveSection('emergency');
    sessionStorage.setItem(ACTIVE_EMERGENCY_STORAGE_KEY, JSON.stringify(updated));

    // 2. ZKP / ABHA proof flow requires a linked ABHA account — skip for standard users.
    if (!abhaPatient) return;

    setSelectedAlert(alert);
    setProofStage('history');
    setEligibilityMessage('');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const historyRes = await fetch('/mock_health_records.json');
    const historyBundle = await historyRes.json();
    const eligibility = parseEligibility(historyBundle, abhaPatient.abhaId);
    if (!eligibility.eligible) {
      setEligibilityMessage(eligibility.reason);
      setProofStage('blocked');
      return;
    }
    const donorCoordinates = gatewayUser?.location?.coordinates || [0, 0];
    const etaMinutes = Math.max(8, Math.round((parseFloat(alert.distance || '5') || 5) * 3));
    socketRef.current?.emit('donor-location-update', {
      requestId: alert.requestId || alert.id,
      donorAlias: `ABHA-${abhaPatient.abhaId}`,
      donorName: abhaPatient.name,
      abhaStatus: abhaVerified ? 'ABHA Verified' : 'Identity Linked',
      bloodGroup: abhaPatient.bloodGroup,
      hospital: alert.hospital,
      requestTitle: alert.message || alert.title,
      etaMinutes,
      coordinates: { longitude: donorCoordinates[0], latitude: donorCoordinates[1] },
      currentRegion: gatewayUser?.currentRegion || 'south-zone',
    });
    setProofStage('generating');
    await new Promise((resolve) => setTimeout(resolve, 1800));
    createProof(
      { id: alert.requestId || alert.id, title: alert.message || alert.title, hospital: alert.hospital, department: alert.requesterRole || 'Regional Dispatch', mapLink: 'https://maps.google.com/?q=Regional+Hospital' },
      abhaPatient
    );
    setProofStage('verified');
  };

  const handleDecline = (alert) => {
    socketRef.current?.emit('decline_request', { requestId: alert.requestId || alert.id });
    setActiveRequest(null);
    setPersistentAlert(null);
    setShowToast(false);
    sessionStorage.removeItem(ACTIVE_EMERGENCY_STORAGE_KEY);
  };

  // NOTE: Do NOT return null when abhaPatient is missing.
  // Non-ABHA users still need to see the dashboard and receive emergency alerts.

  return (
    <div className="space-y-8 max-w-7xl mx-auto">

      {/* ── Floating emergency quick-access button (top-right) ─────────────── */}
      <AnimatePresence>
        {activeRequest && (
          <motion.button
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            onClick={() => setActiveSection('emergency')}
            id="floating-emergency-btn"
            className="fixed right-6 top-22 z-40 max-w-xs rounded-[1.25rem] border border-red-400/40 bg-red-500/15 p-4 text-left shadow-2xl backdrop-blur-xl hover:bg-red-500/20 transition-colors"
          >
            <div className="flex items-start gap-3">
              <Siren className="mt-0.5 h-5 w-5 text-red-300 animate-pulse" />
              <div>
                <p className="text-sm font-bold text-white">🚨 Emergency Action Required</p>
                <p className="mt-0.5 text-xs text-red-200">{activeRequest.bloodGroup} · {activeRequest.distance}km · {timeLeft}</p>
              </div>
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── In-app emergency toast (bottom-right) ─────────────────────────── */}
      <AnimatePresence>
        {showToast && activeRequest && (
          <EmergencyToast
            alert={activeRequest}
            onViewTab={() => { setActiveSection('emergency'); setShowToast(false); }}
            onDismiss={() => setShowToast(false)}
          />
        )}
      </AnimatePresence>

      {/* ── 🚨 ACTIVE EMERGENCY / Dashboard tab strip ──────────────────────── */}
      <AnimatePresence>
        {activeRequest && (
          <motion.div
            key="emergency-tab-strip"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="flex gap-1.5 rounded-[1.4rem] border border-white/10 bg-slate-900/70 p-1.5 backdrop-blur-md"
          >
            <button
              onClick={() => setActiveSection('dashboard')}
              id="tab-dashboard-btn"
              className={`flex-1 rounded-[1rem] px-4 py-2.5 text-sm font-semibold transition-all ${
                activeSection === 'dashboard'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveSection('emergency')}
              id="tab-active-emergency"
              className={`flex flex-1 items-center justify-center gap-2 rounded-[1rem] px-4 py-2.5 text-sm font-bold transition-all ${
                activeSection === 'emergency'
                  ? 'bg-red-500/25 text-red-200 ring-1 ring-red-400/40 shadow-sm'
                  : 'text-red-300 hover:text-red-200 hover:bg-red-500/10'
              }`}
            >
              <Siren className="h-4 w-4 animate-pulse" />
              🚨 ACTIVE EMERGENCY
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Donor locked banner ────────────────────────────────────────────── */}
      {donorLocked && (
        <Card className="border-[#ff8f1f]/25 bg-[linear-gradient(180deg,rgba(255,143,31,0.18),rgba(255,143,31,0.06))]">
          <CardContent className="p-6">
            <Badge variant="saffron">Donor Status Locked</Badge>
            <h2 className="mt-4 text-2xl font-semibold text-white">Profile Incomplete. Blood Group verification required to activate Donor Status.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-200">You can still request blood as a patient. Complete your profile to unlock donor status and accept emergency donation alerts.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Hero card ─────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-[#0b4ea2]/25">
        <CardContent className="grid-shell relative grid gap-8 p-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="absolute inset-y-0 right-0 w-80 bg-[radial-gradient(circle_at_center,rgba(255,143,31,0.14),transparent_68%)]" />
          <div className="relative">
            <Badge variant="blue" className="mb-4"><BadgeCheck className="h-3.5 w-3.5" />{abhaVerified ? 'ABHA Verified Identity' : 'Gateway Linked Identity'}</Badge>
            <h1 className="max-w-2xl text-3xl font-semibold text-white sm:text-4xl">Regional emergency donor console</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">LifeLink listens for region-room emergency broadcasts and verifies your 90-day eligibility before any donor action is confirmed.</p>
            <div className="mt-7 grid gap-4 sm:grid-cols-3">
              {[
                { label: 'ABHA ID', value: abhaPatient.abhaId, icon: BadgeCheck },
                { label: 'Current Region', value: gatewayUser?.currentRegion || 'south-zone', icon: MapPin },
                { label: 'Verification Tier', value: gatewayUser?.verificationTier || 'Facility-Verified', icon: ShieldCheck },
              ].map((item) => (
                <div key={item.label} className="rounded-[1.35rem] border border-white/10 bg-white/6 p-4">
                  <item.icon className="mb-3 h-5 w-5 text-[#8bc0ff]" />
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative rounded-[1.7rem] border border-[#ff8f1f]/25 bg-[linear-gradient(180deg,rgba(255,143,31,0.14),rgba(255,143,31,0.04))] p-6">
            <p className="text-xs uppercase tracking-[0.26em] text-[#ffd19e]">Regional Feed</p>
            <h2 className="mt-3 text-xl font-semibold text-white">Sub-50ms broadcast target</h2>
            <p className="mt-3 text-sm leading-6 text-slate-200">Hospitals broadcast directly into your regional room. No n8n relay, just socket-driven emergency dispatch.</p>
            <div className="mt-6 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Latest Proof</p>
                <p className="mt-2 text-sm font-semibold text-white">{latestProof?.zkStatus || 'No proof generated yet'}</p>
                <p className="mt-1 text-xs text-slate-300">{latestProof?.clearance || 'Accept a regional alert to publish a pre-verified donor profile.'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Open Alerts</p>
                <p className="mt-2 text-sm font-semibold text-white">{activeAlerts.length}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">

        {/* Active Emergency Panel — spans 2 cols when present */}
        <AnimatePresence>
          {activeRequest && activeSection === 'emergency' && (
            <ActiveEmergencyPanel
              request={activeRequest}
              timeLeft={timeLeft}
              donorLocked={donorLocked}
              onAccept={handleAccept}
              onDecline={handleDecline}
            />
          )}
        </AnimatePresence>

        {/* Blood Request Card */}
        <Card>
          <CardHeader>
            <Badge variant="blue">Patient Request Access</Badge>
            <CardTitle>Request blood even before donor verification</CardTitle>
            <CardDescription>All ABHA-linked users can raise a blood request. Only facility-verified users can donate and accept Red Alerts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <select value={requestDraft.bloodGroup} onChange={(e) => setRequestDraft((prev) => ({ ...prev, bloodGroup: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none" id="select-blood-group-request">
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => <option key={bg} value={bg} className="bg-slate-900">{bg}</option>)}
              </select>
              <select value={requestDraft.urgency} onChange={(e) => setRequestDraft((prev) => ({ ...prev, urgency: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none" id="select-urgency-request">
                {['Critical', 'High', 'Medium'].map((urgency) => <option key={urgency} value={urgency} className="bg-slate-900">{urgency}</option>)}
              </select>
            </div>
            <Button onClick={handleCreateRequest} className="w-full" id="btn-request-blood">
              <Droplet className="h-4 w-4" />
              Request Blood Support
            </Button>
            {requestStatus && <div className="rounded-[1.2rem] border border-[#0b4ea2]/25 bg-[#0b4ea2]/10 px-4 py-3 text-sm text-slate-100">{requestStatus}</div>}
          </CardContent>
        </Card>

        {/* Regional Broadcast Alerts */}
        <Card>
          <CardHeader>
            <Badge variant="saffron">Regional Broadcast</Badge>
            <CardTitle>Emergency alerts in your current region</CardTitle>
            <CardDescription>Only verified, nearby donors inside the 5 km geofence receive these emergency alerts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeAlerts.length > 0 ? activeAlerts.map((alert, index) => (
              <motion.div key={`${alert.requestId || alert.id}-${index}`} layout className="flex flex-col gap-4 rounded-[1.5rem] border border-red-400/20 bg-red-500/10 p-5 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="saffron">{alert.urgency || 'Critical'}</Badge>
                    <Badge variant="subtle">{alert.currentRegion}</Badge>
                    {alert.distance && <Badge variant="subtle">{alert.distance} km away</Badge>}
                  </div>
                  <h3 className="text-lg font-semibold text-white">{alert.message}</h3>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-slate-300"><MapPin className="h-4 w-4 text-[#8bc0ff]" />{alert.hospital}</p>
                </div>
                <Button onClick={() => handleAccept(alert)} className="min-w-44" disabled={donorLocked} id={`btn-respond-alert-${index}`}>Respond</Button>
              </motion.div>
            )) : <div className="rounded-[1.4rem] border border-dashed border-white/12 bg-white/4 p-6 text-sm text-slate-400">No active regional alerts yet.</div>}
          </CardContent>
        </Card>

        {/* Proof Projection */}
        <Card>
          <CardHeader>
            <Badge variant="blue">Proof Projection</Badge>
            <CardTitle>Pre-verified donor shell</CardTitle>
            <CardDescription>Only your blood group and proof status move forward into the facility command center.</CardDescription>
          </CardHeader>
          <CardContent>
            {latestProof ? (
              <div className="space-y-4 rounded-[1.6rem] border border-emerald-400/25 bg-emerald-500/10 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/75">Anonymized Profile</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">{latestProof.alias}</h3>
                  </div>
                  <ShieldCheck className="h-10 w-10 text-emerald-300" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4"><p className="text-xs text-slate-400">Blood Group</p><p className="mt-2 text-lg font-semibold text-white">{latestProof.bloodGroup}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4"><p className="text-xs text-slate-400">ZKP Status</p><p className="mt-2 text-sm font-semibold text-emerald-300">{latestProof.zkStatus}</p></div>
                </div>
              </div>
            ) : (
              <div className="rounded-[1.6rem] border border-dashed border-white/12 bg-white/4 p-8 text-center">
                <LockKeyhole className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-4 text-sm font-medium text-slate-200">No profile exposed yet</p>
                <p className="mt-2 text-sm text-slate-400">Respond to a regional alert to generate the donor proof.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Persistent full-screen alert modal ────────────────────────────── */}
      <AnimatePresence>
        {persistentAlert && (
          <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-xl rounded-[2rem] border border-red-400/25 bg-[linear-gradient(180deg,rgba(127,29,29,0.94),rgba(69,10,10,0.92))] p-8 shadow-[0_24px_100px_rgba(15,23,42,0.32)]">
              <Badge variant="saffron">Persistent Red Alert</Badge>
              <h3 className="mt-4 text-3xl font-semibold text-white">{persistentAlert.message}</h3>
              <p className="mt-4 text-sm leading-6 text-red-50">This alert stays visible until you respond or dismiss it. Regional dispatch is currently active for {persistentAlert.currentRegion}.</p>
              <div className="mt-8 flex gap-3">
                <Button variant="secondary" size="lg" className="flex-1 bg-white/10 text-white hover:bg-white/15" onClick={() => { setPersistentAlert(null); setActiveSection('emergency'); }} id="btn-open-emergency-tab">Open Emergency Tab</Button>
                <Button size="lg" className="flex-1 bg-[#ff9933] text-[#08111d] hover:bg-[#ffad52]" onClick={() => handleAccept(persistentAlert)} disabled={donorLocked} id="btn-respond-now">Respond Now</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Profile completion modal ───────────────────────────────────────── */}
      <AnimatePresence>
        {profileModalOpen && shouldCompleteProfile && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-xl rounded-[2rem] border border-[#0b4ea2]/25 bg-[linear-gradient(180deg,rgba(8,17,29,0.98),rgba(10,22,39,0.95))] p-8 shadow-[0_30px_120px_rgba(1,10,28,0.55)]">
              <Badge variant="blue">Complete Your Profile</Badge>
              <h3 className="mt-4 text-3xl font-semibold text-white">Tiered verification required</h3>
              <p className="mt-4 text-sm leading-6 text-slate-300">Add your verified blood group and the HFR ID of the lab or hospital that validated it. Without a valid facility ID, you remain Emergency Only.</p>
              <div className="mt-6 space-y-4">
                <select value={profileDraft.bloodGroup} onChange={(e) => setProfileDraft((prev) => ({ ...prev, bloodGroup: e.target.value }))} className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-4 text-white outline-none" id="select-blood-group-profile">
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => <option key={bg} value={bg} className="bg-slate-900">{bg}</option>)}
                </select>
                <input value={profileDraft.verificationSourceId} onChange={(e) => setProfileDraft((prev) => ({ ...prev, verificationSourceId: e.target.value }))} placeholder="Enter ABDM HFR ID of lab/hospital" className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-4 text-white placeholder:text-slate-400 outline-none" id="input-hfr-id" />
              </div>
              <div className="mt-8 flex justify-end"><Button size="lg" onClick={handleProfileComplete} id="btn-save-verification">Save Verification</Button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ZKP / Proof flow modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedAlert && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, scale: 0.92, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} className="w-full max-w-2xl rounded-[2rem] border border-[#0b4ea2]/25 bg-[linear-gradient(180deg,rgba(8,17,29,0.98),rgba(10,22,39,0.95))] p-8 shadow-[0_30px_120px_rgba(1,10,28,0.55)]">
              {proofStage === 'history' && <div className="text-center"><Badge variant="blue" className="mb-6">M3 Consent Manager</Badge><div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-[#0b4ea2]/14"><Activity className="h-14 w-14 animate-spin text-[#8bc0ff]" /></div><h3 className="text-3xl font-semibold text-white">Fetching 90-day History via M3 Consent Manager...</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">Parsing FHIR Observation and Procedure resources for malaria risk and donation cooldown before proof generation.</p></div>}
              {proofStage === 'blocked' && <div className="text-center"><div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-amber-500/16"><ShieldAlert className="h-14 w-14 text-amber-300" /></div><Badge variant="saffron" className="mb-5">Medical Cooling Period</Badge><h3 className="text-3xl font-semibold text-white">Donation blocked for safety</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">{eligibilityMessage}</p><div className="mt-8 flex justify-center"><Button size="lg" className="bg-[#0b4ea2] hover:bg-[#083c7d]" onClick={() => { setSelectedAlert(null); setProofStage('idle'); setEligibilityMessage(''); }} id="btn-return-dashboard">Return to Dashboard</Button></div></div>}
              {proofStage === 'generating' && <div className="text-center"><Badge variant="blue" className="mb-6">Zero-Knowledge Verification</Badge><div className="mx-auto mb-6 flex h-44 w-44 items-center justify-center"><div className="math-loader"><span>zk</span><span>pi</span><span>lm</span><span>inf</span><span>sum</span><span>fx</span></div></div><h3 className="text-3xl font-semibold text-white">Generating ZK-Proof of Eligibility...</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">Eligibility is clear. LifeLink is now publishing a proof-backed donor signal and live coordinates to the facility command center.</p></div>}
              {proofStage === 'verified' && <div className="text-center"><div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-emerald-500/16"><ShieldCheck className="h-14 w-14 text-emerald-300" /></div><Badge variant="success" className="mb-5"><CheckCircle2 className="h-3.5 w-3.5" />Proof Generated</Badge><h3 className="text-3xl font-semibold text-white">Verified: Medical Clearance Proof Generated</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">The facility can now see your blood group, verification tier, live ETA, and proof status, but not your identity or raw records.</p><div className="mt-8 flex justify-center"><Button variant="success" size="lg" onClick={() => { setSelectedAlert(null); setProofStage('idle'); setEligibilityMessage(''); }} id="btn-continue-after-proof"><Sparkles className="h-4 w-4" />Continue</Button></div></div>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
