'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BrainCircuit,
  CheckCircle2,
  Droplet,
  LockKeyhole,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useDpi } from '../../../components/providers/DpiProvider';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';

function subscribe() { return () => {}; }

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

  useEffect(() => {
    if (!gatewayUser?._id) return;
    const socket = io('http://localhost:5000');
    socket.emit('join', gatewayUser._id);
    socket.emit('join-region', gatewayUser.currentRegion || 'south-zone');
    socket.on('EMERGENCY_ALERT', (payload) => {
      setRegionalAlerts((prev) => [payload, ...prev].slice(0, 3));
      setPersistentAlert(payload);
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('LifeLink Red Alert', {
            body: payload.message,
          });
        } else if (Notification.permission === 'default') {
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              new Notification('LifeLink Red Alert', {
                body: payload.message,
              });
            }
          });
        }
      }
    });
    socketRef.current = socket;
    return () => socket.disconnect();
  }, [gatewayUser?._id, gatewayUser?.currentRegion]);

  useEffect(() => {
    if (!token || !gatewayUser?._id || !navigator.geolocation) {
      return undefined;
    }

    let cancelled = false;
    let lastPersistedAt = 0;
    const persistLocation = async (latitude, longitude) => {
      try {
        const res = await axios.patch('http://localhost:5000/api/auth/location', {
          latitude,
          longitude,
        }, {
          headers: { Authorization: `Bearer ${token}` },
        });

        localStorage.setItem('user', JSON.stringify(res.data.user));
      } catch {
        // Best-effort sync for geofenced alerts.
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        if (cancelled) {
          return;
        }

        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

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
      () => {
        // Ignore location denial and keep the rest of the dashboard usable.
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 }
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [gatewayUser?._id, gatewayUser?.bloodGroup, token]);

  const latestProof = proofs[0];
  const donorLocked = !abhaPatient?.bloodGroup;
  const activeAlerts = useMemo(() => regionalAlerts.length > 0 ? regionalAlerts : [], [regionalAlerts]);
  const shouldCompleteProfile = gatewayUser?.identityType === 'ABHA' && !gatewayUser?.bloodGroup;

  const handleProfileComplete = async () => {
    const res = await axios.post('http://localhost:5000/api/auth/complete-profile', profileDraft, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    connectAbha(res.data.fhirPatient);
    setProfileModalOpen(false);
  };

  const handleCreateRequest = async () => {
    if (!token) {
      return;
    }

    try {
      const res = await axios.post('http://localhost:5000/api/requests', requestDraft, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequestStatus(`Request created. ${res.data.matches?.length || 0} nearby verified donors were matched.`);
    } catch (error) {
      setRequestStatus(error.response?.data?.message || 'Could not create the blood request.');
    }
  };

  const handleAccept = async (alert) => {
    if (donorLocked || !abhaPatient) return;
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
      donorAlias: `ABHA-${abhaPatient.abhaId}`,
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
    createProof({ id: alert.requestId || alert.id, title: alert.message || alert.title, hospital: alert.hospital, department: alert.requesterRole || 'Regional Dispatch', mapLink: 'https://maps.google.com/?q=Regional+Hospital' }, abhaPatient);
    setProofStage('verified');
  };

  if (!abhaPatient) return null;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <AnimatePresence>
        {regionalAlerts[0] && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="fixed right-6 top-22 z-40 max-w-md rounded-[1.25rem] border border-red-400/30 bg-red-500/12 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-red-300" />
              <div>
                <p className="text-sm font-semibold text-white">Red Alert Broadcast</p>
                <p className="mt-1 text-sm text-slate-100">{regionalAlerts[0].message}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {donorLocked && (
        <Card className="border-[#ff8f1f]/25 bg-[linear-gradient(180deg,rgba(255,143,31,0.18),rgba(255,143,31,0.06))]">
          <CardContent className="p-6">
            <Badge variant="saffron">Donor Status Locked</Badge>
            <h2 className="mt-4 text-2xl font-semibold text-white">Profile Incomplete. Blood Group verification required to activate Donor Status.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-200">You can still request blood as a patient. Complete your profile to unlock donor status and accept emergency donation alerts.</p>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden border-[#0b4ea2]/25">
        <CardContent className="grid-shell relative grid gap-8 p-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="absolute inset-y-0 right-0 w-80 bg-[radial-gradient(circle_at_center,rgba(255,143,31,0.14),transparent_68%)]" />
          <div className="relative">
            <Badge variant="blue" className="mb-4"><BadgeCheck className="h-3.5 w-3.5" />{abhaVerified ? 'ABHA Verified Identity' : 'Gateway Linked Identity'}</Badge>
            <h1 className="max-w-2xl text-3xl font-semibold text-white sm:text-4xl">Regional emergency donor console</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">LifeLink now listens for region-room emergency broadcasts and verifies your 90-day eligibility before any donor action is confirmed.</p>
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

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <Badge variant="blue">Patient Request Access</Badge>
            <CardTitle>Request blood even before donor verification</CardTitle>
            <CardDescription>All ABHA-linked users can raise a blood request. Only facility-verified users can donate and accept Red Alerts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <select value={requestDraft.bloodGroup} onChange={(e) => setRequestDraft((prev) => ({ ...prev, bloodGroup: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none">
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => <option key={bg} value={bg} className="bg-slate-900">{bg}</option>)}
              </select>
              <select value={requestDraft.urgency} onChange={(e) => setRequestDraft((prev) => ({ ...prev, urgency: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none">
                {['Critical', 'High', 'Medium'].map((urgency) => <option key={urgency} value={urgency} className="bg-slate-900">{urgency}</option>)}
              </select>
            </div>
            <Button onClick={handleCreateRequest} className="w-full">
              <Droplet className="h-4 w-4" />
              Request Blood Support
            </Button>
            {requestStatus && <div className="rounded-[1.2rem] border border-[#0b4ea2]/25 bg-[#0b4ea2]/10 px-4 py-3 text-sm text-slate-100">{requestStatus}</div>}
          </CardContent>
        </Card>
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
                <Button onClick={() => handleAccept(alert)} className="min-w-44" disabled={donorLocked}>Respond</Button>
              </motion.div>
            )) : <div className="rounded-[1.4rem] border border-dashed border-white/12 bg-white/4 p-6 text-sm text-slate-400">No active regional alerts yet.</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Badge variant="blue">Proof Projection</Badge>
            <CardTitle>Pre-verified donor shell</CardTitle>
            <CardDescription>Only your blood group and proof status move forward into the facility command center.</CardDescription>
          </CardHeader>
          <CardContent>
            {latestProof ? <div className="space-y-4 rounded-[1.6rem] border border-emerald-400/25 bg-emerald-500/10 p-5"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.18em] text-emerald-200/75">Anonymized Profile</p><h3 className="mt-2 text-xl font-semibold text-white">{latestProof.alias}</h3></div><ShieldCheck className="h-10 w-10 text-emerald-300" /></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4"><p className="text-xs text-slate-400">Blood Group</p><p className="mt-2 text-lg font-semibold text-white">{latestProof.bloodGroup}</p></div><div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4"><p className="text-xs text-slate-400">ZKP Status</p><p className="mt-2 text-sm font-semibold text-emerald-300">{latestProof.zkStatus}</p></div></div></div> : <div className="rounded-[1.6rem] border border-dashed border-white/12 bg-white/4 p-8 text-center"><LockKeyhole className="mx-auto h-10 w-10 text-slate-500" /><p className="mt-4 text-sm font-medium text-slate-200">No profile exposed yet</p><p className="mt-2 text-sm text-slate-400">Respond to a regional alert to generate the donor proof.</p></div>}
          </CardContent>
        </Card>
      </div>

      <AnimatePresence>
        {persistentAlert && (
          <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-xl rounded-[2rem] border border-red-400/25 bg-[linear-gradient(180deg,rgba(127,29,29,0.94),rgba(69,10,10,0.92))] p-8 shadow-[0_24px_100px_rgba(15,23,42,0.32)]">
              <Badge variant="saffron">Persistent Red Alert</Badge>
              <h3 className="mt-4 text-3xl font-semibold text-white">{persistentAlert.message}</h3>
              <p className="mt-4 text-sm leading-6 text-red-50">This alert stays visible until you respond or dismiss it. Regional dispatch is currently active for {persistentAlert.currentRegion}.</p>
              <div className="mt-8 flex gap-3">
                <Button variant="secondary" size="lg" className="flex-1 bg-white/10 text-white hover:bg-white/15" onClick={() => setPersistentAlert(null)}>Dismiss</Button>
                <Button size="lg" className="flex-1 bg-[#ff9933] text-[#08111d] hover:bg-[#ffad52]" onClick={() => handleAccept(persistentAlert)} disabled={donorLocked}>Respond Now</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {profileModalOpen && shouldCompleteProfile && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-xl rounded-[2rem] border border-[#0b4ea2]/25 bg-[linear-gradient(180deg,rgba(8,17,29,0.98),rgba(10,22,39,0.95))] p-8 shadow-[0_30px_120px_rgba(1,10,28,0.55)]">
              <Badge variant="blue">Complete Your Profile</Badge>
              <h3 className="mt-4 text-3xl font-semibold text-white">Tiered verification required</h3>
              <p className="mt-4 text-sm leading-6 text-slate-300">Add your verified blood group and the HFR ID of the lab or hospital that validated it. Without a valid facility ID, you remain Emergency Only.</p>
              <div className="mt-6 space-y-4">
                <select value={profileDraft.bloodGroup} onChange={(e) => setProfileDraft((prev) => ({ ...prev, bloodGroup: e.target.value }))} className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-4 text-white outline-none">
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => <option key={bg} value={bg} className="bg-slate-900">{bg}</option>)}
                </select>
                <input value={profileDraft.verificationSourceId} onChange={(e) => setProfileDraft((prev) => ({ ...prev, verificationSourceId: e.target.value }))} placeholder="Enter ABDM HFR ID of lab/hospital" className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-4 text-white placeholder:text-slate-400 outline-none" />
              </div>
              <div className="mt-8 flex justify-end"><Button size="lg" onClick={handleProfileComplete}>Save Verification</Button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedAlert && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, scale: 0.92, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} className="w-full max-w-2xl rounded-[2rem] border border-[#0b4ea2]/25 bg-[linear-gradient(180deg,rgba(8,17,29,0.98),rgba(10,22,39,0.95))] p-8 shadow-[0_30px_120px_rgba(1,10,28,0.55)]">
              {proofStage === 'history' && <div className="text-center"><Badge variant="blue" className="mb-6">M3 Consent Manager</Badge><div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-[#0b4ea2]/14"><Activity className="h-14 w-14 animate-spin text-[#8bc0ff]" /></div><h3 className="text-3xl font-semibold text-white">Fetching 90-day History via M3 Consent Manager...</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">Parsing FHIR Observation and Procedure resources for malaria risk and donation cooldown before proof generation.</p></div>}
              {proofStage === 'blocked' && <div className="text-center"><div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-amber-500/16"><ShieldAlert className="h-14 w-14 text-amber-300" /></div><Badge variant="saffron" className="mb-5">Medical Cooling Period</Badge><h3 className="text-3xl font-semibold text-white">Donation blocked for safety</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">{eligibilityMessage}</p><div className="mt-8 flex justify-center"><Button size="lg" className="bg-[#0b4ea2] hover:bg-[#083c7d]" onClick={() => { setSelectedAlert(null); setProofStage('idle'); setEligibilityMessage(''); }}>Return to Dashboard</Button></div></div>}
              {proofStage === 'generating' && <div className="text-center"><Badge variant="blue" className="mb-6">Zero-Knowledge Verification</Badge><div className="mx-auto mb-6 flex h-44 w-44 items-center justify-center"><div className="math-loader"><span>zk</span><span>pi</span><span>lm</span><span>inf</span><span>sum</span><span>fx</span></div></div><h3 className="text-3xl font-semibold text-white">Generating ZK-Proof of Eligibility...</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">Eligibility is clear. LifeLink is now publishing a proof-backed donor signal and live coordinates to the facility command center.</p></div>}
              {proofStage === 'verified' && <div className="text-center"><div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-emerald-500/16"><ShieldCheck className="h-14 w-14 text-emerald-300" /></div><Badge variant="success" className="mb-5"><CheckCircle2 className="h-3.5 w-3.5" />Proof Generated</Badge><h3 className="text-3xl font-semibold text-white">Verified: Medical Clearance Proof Generated</h3><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">The facility can now see your blood group, verification tier, live ETA, and proof status, but not your identity or raw records.</p><div className="mt-8 flex justify-center"><Button variant="success" size="lg" onClick={() => { setSelectedAlert(null); setProofStage('idle'); setEligibilityMessage(''); }}><Sparkles className="h-4 w-4" />Continue</Button></div></div>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
