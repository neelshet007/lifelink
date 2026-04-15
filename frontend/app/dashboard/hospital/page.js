'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { Activity, BadgeCheck, Building2, Download, MapPin, Navigation, Package, Radio, Search, Siren, UserRoundPlus } from 'lucide-react';
import GlobalMeshAlertPanel from '../../../components/GlobalMeshAlertPanel';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { getRealtimeSocket } from '../../../lib/realtime';
import { API_URL, getStoredUser, getToken } from '../../../lib/session';
import { getSocketStoreState, socketStoreSubscribe } from '../../../lib/socketStore';

function subscribe(callback) {
  return socketStoreSubscribe(callback);
}

function formatCoord(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(5) : '--';
}

function useEtaCountdown(etaMinutes, active) {
  const [eta, setEta] = useState(etaMinutes);
  const timerRef = useRef(null);
  useEffect(() => { setEta(etaMinutes); }, [etaMinutes]);
  useEffect(() => {
    if (!active || !Number.isFinite(eta) || eta <= 0) return;
    timerRef.current = setInterval(() => {
      setEta((prev) => {
        const next = prev - 1;
        if (next <= 0) { clearInterval(timerRef.current); return 0; }
        return next;
      });
    }, 60_000);
    return () => clearInterval(timerRef.current);
  }, [active, eta]);
  return eta;
}

function coordsToMapOffset(donorCoords, hospitalCoords) {
  if (!donorCoords?.latitude || !hospitalCoords?.latitude) return { left: '78%', top: '28%' };
  const latDelta = donorCoords.latitude - hospitalCoords.latitude;
  const lngDelta = donorCoords.longitude - hospitalCoords.longitude;
  const scaleFactor = 40 / 0.05;
  const leftPct = Math.min(90, Math.max(10, 50 + lngDelta * scaleFactor));
  const topPct = Math.min(90, Math.max(10, 50 - latDelta * scaleFactor));
  return { left: `${leftPct.toFixed(1)}%`, top: `${topPct.toFixed(1)}%` };
}

export default function HospitalDashboard() {
  const { connectionStatus, meshAlerts, requestConfirmed } = useSyncExternalStore(subscribe, getSocketStoreState, getSocketStoreState);
  const user = useMemo(() => getStoredUser(), []);
  const token = useMemo(() => getToken(), []);

  // Facility request draft
  const [requestDraft, setRequestDraft] = useState({ bloodGroup: 'O-', urgency: 'Critical', bloodUnits: 1 });
  const [requestResult, setRequestResult] = useState(null);
  const [requesting, setRequesting] = useState(false);

  // Socket-triggered broadcast
  const [meshBroadcasting, setMeshBroadcasting] = useState(false);

  // Acceptance feedback for the requester
  const [acceptedEmergency, setAcceptedEmergency] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  // CRM
  const [lookupValue, setLookupValue] = useState('');
  const [lookupProfile, setLookupProfile] = useState(null);
  const [ledger, setLedger] = useState({ entries: [] });

  const [activeTab, setActiveTab] = useState('command');

  const etaDisplay = useEtaCountdown(acceptedEmergency?.etaMinutes, Boolean(acceptedEmergency));
  const markerPos = coordsToMapOffset(
    acceptedEmergency?.coordinates,
    requestResult?.meta?.hospitalCoords
  );

  // ── Socket listeners ───────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getRealtimeSocket();

    const onAccepted = (payload) => {
      setAcceptedEmergency({ ...payload, status: 'In Progress' });
      setStatusMessage(`🟢 Donor Found: ${payload.donorName} is ${payload.distanceKm ?? '?'} km away · ETA ${payload.etaMinutes} mins`);
      setRequestResult((current) =>
        current && String(current.request?._id || current.requestId) === String(payload.requestId)
          ? { ...current, request: current.request ? { ...current.request, status: 'Accepted' } : current.request }
          : current
      );
    };

    const onDeclined = (payload) => {
      setStatusMessage(`⚠️ Donor ${payload.donorName} declined. Waiting for another donor...`);
    };

    const onDonorResponse = (payload) => {
      if (payload.status === 'accepted') onAccepted(payload);
      else onDeclined(payload);
    };

    const onLocation = (payload) => {
      setAcceptedEmergency((current) =>
        current && String(current.requestId) === String(payload.requestId)
          ? { ...current, ...payload, coordinates: payload.coordinates || current.coordinates, distanceKm: payload.distanceKm ?? current.distanceKm, etaMinutes: payload.etaMinutes ?? current.etaMinutes }
          : current
      );
    };

    const onStockConfirmed = (payload) => {
      setAcceptedEmergency({ ...payload, donorName: payload.facilityName, status: 'Stock Confirmed' });
      setStatusMessage(`✅ Blood Reserved: ${payload.facilityName} has allocated ${payload.bloodUnits} units of ${payload.bloodGroup}.`);
    };

    const onMeshBroadcastAck = () => setMeshBroadcasting(false);

    socket.on('DONOR_ACCEPTED', onAccepted);
    socket.on('DONOR_DECLINED', onDeclined);
    socket.on('DONOR_RESPONSE_RECEIVED', onDonorResponse);
    socket.on('LOCATION_UPDATE', onLocation);
    socket.on('EMERGENCY_ACCEPTED', onAccepted);
    socket.on('EMERGENCY_DECLINED', onDeclined);
    socket.on('DONOR_LIVE_LOCATION', onLocation);
    socket.on('STOCK_CONFIRMED', onStockConfirmed);
    socket.on('REQUEST_BLOOD_ACK', onMeshBroadcastAck);

    return () => {
      socket.off('DONOR_ACCEPTED', onAccepted);
      socket.off('DONOR_DECLINED', onDeclined);
      socket.off('DONOR_RESPONSE_RECEIVED', onDonorResponse);
      socket.off('LOCATION_UPDATE', onLocation);
      socket.off('EMERGENCY_ACCEPTED', onAccepted);
      socket.off('EMERGENCY_DECLINED', onDeclined);
      socket.off('DONOR_LIVE_LOCATION', onLocation);
      socket.off('STOCK_CONFIRMED', onStockConfirmed);
      socket.off('REQUEST_BLOOD_ACK', onMeshBroadcastAck);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API_URL}/api/hospital/ledger`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setLedger(res.data || { entries: [] }))
      .catch(() => setLedger({ entries: [] }));
  }, [token]);

  // ── Actions ────────────────────────────────────────────────────────────────────

  // Unified: speed (Socket) + persistence (DB)
  const handleUnifiedBroadcast = async () => {
    if (!token) return;
    
    // Identical payload for both
    const payload = {
      ...requestDraft,
      bloodUnits: requestDraft.bloodUnits || 1,
      requestType: 'Blood Request',
    };

    // 1. Instant Socket Emit (Fire)
    const socket = getRealtimeSocket();
    setMeshBroadcasting(true);
    socket.emit('REQUEST_BLOOD', payload);
    
    // 2. Background DB Save (Follow-up)
    setRequesting(true);
    setStatusMessage('');
    setAcceptedEmergency(null);
    
    try {
      const res = await axios.post(`${API_URL}/api/requests`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequestResult(res.data);
      setStatusMessage('🚀 Broadcast Live & Recorded');
    } catch (error) {
      // If DB fails but Socket succeeded
      setStatusMessage('⚠️ The broadcast is live, but was not saved to history. Please try re-sending for a permanent record.');
    } finally {
      setRequesting(false);
      setMeshBroadcasting(false);
    }
  };

  const handleLookup = async () => {
    if (!token || !lookupValue.trim()) return;
    setStatusMessage('');
    try {
      const res = await axios.get(`${API_URL}/api/hospital/sandbox-profile/${encodeURIComponent(lookupValue.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLookupProfile(res.data);
    } catch (error) {
      setLookupProfile(null);
      setStatusMessage(error.response?.data?.message || 'ABHA lookup failed.');
    }
  };

  const handleLedgerIntake = async () => {
    if (!token || !lookupProfile) return;
    try {
      const res = await axios.post(
        `${API_URL}/api/hospital/ledger/intake`,
        { abhaAddress: lookupProfile.abhaAddress },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLedger(res.data);
      setStatusMessage('Donor added to the facility private ledger.');
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Unable to add donor to the private ledger.');
    }
  };

  const handleExport = async () => {
    if (!token) return;
    const res = await axios.get(`${API_URL}/api/hospital/ledger/export`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(user?.name || 'facility').replace(/\s+/g, '-').toLowerCase()}-private-ledger.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-2 rounded-[1rem] bg-white/5 p-1 border border-white/10">
          <TabsTrigger value="command" className="rounded-[0.8rem] transition-all">Command Center</TabsTrigger>
          <TabsTrigger value="mesh" className="rounded-[0.8rem] transition-all relative">
            Mesh Alerts
            {meshAlerts?.length > 0 && (
              <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {meshAlerts.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── COMMAND CENTER ──────────────────────────────────────────────────── */}
        <TabsContent value="command" className="space-y-6">

          {/* REQUEST_CONFIRMED banner for this facility (when another entity responds) */}
          {requestConfirmed && (
            <div className="rounded-[1.2rem] border border-emerald-400/30 bg-emerald-500/10 p-4 flex items-center gap-3">
              <Radio className="h-5 w-5 text-emerald-400 animate-pulse shrink-0" />
              <div>
                <p className="font-semibold text-emerald-300">{requestConfirmed.message}</p>
                <p className="text-xs text-slate-400 mt-0.5">From: {requestConfirmed.responderName} · {requestConfirmed.responderRole}</p>
              </div>
            </div>
          )}

          {/* Facility summary */}
          <Card>
            <CardHeader>
              <Badge variant="blue"><Building2 className="h-3.5 w-3.5" />Facility Command</Badge>
              <CardTitle>Universal Mesh Broadcast</CardTitle>
              <CardDescription>
                Broadcast instantly hits every Hospital, Blood Bank, and User in your radius — no role restrictions.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-5">
              {[
                ['Facility', user?.name],
                ['HFR ID', user?.hfrFacilityId || 'Pending'],
                ['DCGI', user?.dcgiLicenseNumber || 'Not required'],
                ['Private Ledger', `${ledger.entries?.length || 0} donors`],
                ['Socket', connectionStatus === 'online' ? 'System Online' : connectionStatus === 'connecting' ? 'Connecting' : 'System Offline'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[1rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
                  <p className="mt-2 text-sm font-semibold text-white">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Live donor tracking panel */}
          {acceptedEmergency && (
            <Card className="border-emerald-400/30 bg-[linear-gradient(180deg,rgba(5,150,105,0.22),rgba(15,23,42,0.95))]">
              <CardHeader>
                <Badge variant="success"><Navigation className="h-3.5 w-3.5" />Response Confirmed</Badge>
                <CardTitle>
                  Help coming from: {acceptedEmergency.donorName} ({acceptedEmergency.distanceKm ?? '?'} km away)
                </CardTitle>
                <CardDescription>
                  Blood Group: {acceptedEmergency.bloodGroup} · ETA: {etaDisplay} min{etaDisplay !== 1 ? 's' : ''} · Status: {acceptedEmergency.status}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1.15fr,0.85fr]">
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Responder</p>
                      <p className="mt-2 font-semibold text-white">{acceptedEmergency.donorName}</p>
                    </div>
                    <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Distance Snapshot</p>
                      <p className="mt-2 text-white">{acceptedEmergency.distanceKm ?? 'Live'} km</p>
                    </div>
                  </div>
                  <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Live Coordinates</p>
                    <p className="mt-2 font-mono text-white">
                      {formatCoord(acceptedEmergency.coordinates?.latitude)}, {formatCoord(acceptedEmergency.coordinates?.longitude)}
                    </p>
                  </div>
                  <div className="rounded-[1rem] border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                    {statusMessage}
                  </div>
                </div>
                {/* Map */}
                <div className="rounded-[1.4rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),rgba(15,23,42,0.85))] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Live Map</p>
                  <p className="mt-2 text-sm font-semibold text-white">Updating every 5s</p>
                  <div className="relative mt-4 h-48 overflow-hidden rounded-[1.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.45),rgba(2,6,23,0.9))]">
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px]" />
                    <div className="absolute left-[20%] top-[66%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-[#ff8f1f] px-3 py-2 text-xs font-semibold text-slate-950 shadow-[0_12px_30px_rgba(255,143,31,0.32)]">
                      <Building2 className="h-3.5 w-3.5" />
                      Facility
                    </div>
                    <div className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.28)] transition-all duration-1000 ease-linear"
                      style={{ left: markerPos.left, top: markerPos.top }}>
                      <MapPin className="h-3.5 w-3.5" />
                      Responder
                    </div>
                    <div className="absolute inset-0">
                      <svg viewBox="0 0 100 100" className="h-full w-full">
                        <path d="M 21 66 C 42 63, 56 50, 81 31" fill="none" stroke="rgba(255,255,255,0.55)" strokeDasharray="5 5" strokeWidth="1.4" />
                      </svg>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Broadcast controls */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <Badge variant="saffron"><Siren className="h-3.5 w-3.5" />Any-to-Any Broadcast</Badge>
                <CardTitle>Create universal mesh request</CardTitle>
                <CardDescription>
                  The broadcast reaches every Hospital, Blood Bank, and compatible User in your area simultaneously.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <select
                    value={requestDraft.bloodGroup}
                    onChange={(e) => setRequestDraft((prev) => ({ ...prev, bloodGroup: e.target.value }))}
                    className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none"
                  >
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => (
                      <option key={group} value={group} className="bg-slate-950">{group}</option>
                    ))}
                  </select>
                  <select
                    value={requestDraft.urgency}
                    onChange={(e) => setRequestDraft((prev) => ({ ...prev, urgency: e.target.value }))}
                    className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none"
                  >
                    {['Critical', 'Immediate', 'Standard'].map((urgency) => (
                      <option key={urgency} value={urgency} className="bg-slate-950">{urgency}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={requestDraft.bloodUnits}
                    onChange={(e) => setRequestDraft((prev) => ({ ...prev, bloodUnits: Number(e.target.value) }))}
                    placeholder="Units"
                    className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none"
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <Button
                    onClick={handleUnifiedBroadcast}
                    size="lg"
                    disabled={requesting}
                    className="w-full bg-red-600 hover:bg-red-700 text-white h-16 text-lg font-bold rounded-[1.2rem] shadow-[0_10px_40px_rgba(220,38,38,0.25)] gap-3 border-b-4 border-red-800 active:border-b-0 active:translate-y-1 transition-all"
                  >
                    {requesting ? (
                      <><Activity className="h-6 w-6 animate-spin" /> Recording Broadcast...</>
                    ) : (
                      <><Radio className="h-6 w-6 animate-pulse" /> 🚀 Initiate Emergency Broadcast</>
                    )}
                  </Button>
                </div>
                {statusMessage && !acceptedEmergency && (
                  <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    {statusMessage}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Private CRM */}
            <Card>
              <CardHeader>
                <Badge variant="blue"><UserRoundPlus className="h-3.5 w-3.5" />Private CRM</Badge>
                <CardTitle>Donation drive intake</CardTitle>
                <CardDescription>
                  Enter an ABHA number or address to fetch the donor profile and save it to your facility-owned ledger.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <input
                    value={lookupValue}
                    onChange={(e) => setLookupValue(e.target.value)}
                    placeholder="ABHA number or address"
                    className="flex-1 rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white placeholder:text-slate-400 outline-none"
                  />
                  <Button variant="secondary" onClick={handleLookup}><Search className="h-4 w-4" /> Lookup</Button>
                </div>
                {lookupProfile && (
                  <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    <p className="font-semibold text-white">{lookupProfile.name}</p>
                    <p className="mt-1">{lookupProfile.abhaNumber} | {lookupProfile.abhaAddress}</p>
                    <p className="mt-1">Blood Group: {lookupProfile.bloodGroup || 'Pending'} | {lookupProfile.verificationTier}</p>
                    <Button className="mt-4" onClick={handleLedgerIntake}>Add to Private Ledger</Button>
                  </div>
                )}
                <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">Recent ledger entries</p>
                    <Button variant="secondary" onClick={handleExport}><Download className="h-4 w-4" /> Export</Button>
                  </div>
                  <div className="space-y-3">
                    {(ledger.entries || []).slice(0, 5).map((entry) => (
                      <div key={entry._id || entry.abhaAddress} className="rounded-[0.9rem] border border-white/10 bg-slate-950/30 p-3 text-sm text-slate-200">
                        <p className="font-semibold text-white">{entry.donorName}</p>
                        <p className="mt-1">{entry.abhaAddress}</p>
                        <p className="mt-1 inline-flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-[#8bc0ff]" /> {entry.bloodGroup || 'Pending group'} | {entry.verificationTier}</p>
                      </div>
                    ))}
                    {!(ledger.entries || []).length && <div className="text-sm text-slate-400">No donors added yet.</div>}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── MESH ALERTS ─────────────────────────────────────────────────────── */}
        <TabsContent value="mesh" className="space-y-4">
          <Card className="border-amber-400/20 bg-[linear-gradient(180deg,rgba(146,64,14,0.12),rgba(15,23,42,0.95))]">
            <CardHeader>
              <Badge variant="saffron"><Radio className="h-3.5 w-3.5 animate-pulse" />Live Mesh Feed</Badge>
              <CardTitle>Incoming requests from all entities</CardTitle>
              <CardDescription>
                All Hospitals, Blood Banks, and Users within 10 km automatically appear here in real time.
                {user?.role === 'Blood Bank' ? ' As a Blood Bank, you can allocate from stock instantly.' : ' Accept to confirm help is coming.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GlobalMeshAlertPanel />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
