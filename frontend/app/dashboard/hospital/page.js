'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { Activity, BadgeCheck, Building2, Download, MapPin, Navigation, Search, Siren, UserRoundPlus } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { getRealtimeSocket } from '../../../lib/realtime';
import { API_URL, getStoredUser, getToken } from '../../../lib/session';
import { getSocketStoreState, socketStoreSubscribe } from '../../../lib/socketStore';

function subscribe(callback) {
  return socketStoreSubscribe(callback);
}

function formatCoord(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(5) : '--';
}

export default function HospitalDashboard() {
  const { connectionStatus } = useSyncExternalStore(subscribe, getSocketStoreState, getSocketStoreState);
  const user = useMemo(() => getStoredUser(), []);
  const token = useMemo(() => getToken(), []);
  const [requestDraft, setRequestDraft] = useState({ bloodGroup: 'O-', urgency: 'Critical' });
  const [requestResult, setRequestResult] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [acceptedEmergency, setAcceptedEmergency] = useState(null);
  const [lookupValue, setLookupValue] = useState('');
  const [lookupProfile, setLookupProfile] = useState(null);
  const [ledger, setLedger] = useState({ entries: [] });
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const socket = getRealtimeSocket();

    const onAccepted = (payload) => {
      setAcceptedEmergency({ ...payload, status: 'In Progress' });
      setStatusMessage(`Hero ${payload.donorName} is on the way! ETA ${payload.etaMinutes} mins.`);
      setRequestResult((current) => current && String(current.request?._id || current.requestId) === String(payload.requestId)
        ? {
            ...current,
            request: current.request ? { ...current.request, status: 'Accepted' } : current.request,
          }
        : current);
    };

    const onDeclined = (payload) => {
      setStatusMessage(`Donor ${payload.donorName} declined the emergency.`);
    };

    const onLocation = (payload) => {
      setAcceptedEmergency((current) => current && String(current.requestId) === String(payload.requestId)
        ? {
            ...current,
            ...payload,
            coordinates: payload.coordinates || current.coordinates,
            distanceKm: payload.distanceKm ?? current.distanceKm,
            etaMinutes: payload.etaMinutes ?? current.etaMinutes,
          }
        : current);
    };

    socket.on('DONOR_ACCEPTED', onAccepted);
    socket.on('DONOR_DECLINED', onDeclined);
    socket.on('LOCATION_UPDATE', onLocation);
    socket.on('EMERGENCY_ACCEPTED', onAccepted);
    socket.on('EMERGENCY_DECLINED', onDeclined);
    socket.on('DONOR_LIVE_LOCATION', onLocation);

    return () => {
      socket.off('DONOR_ACCEPTED', onAccepted);
      socket.off('DONOR_DECLINED', onDeclined);
      socket.off('LOCATION_UPDATE', onLocation);
      socket.off('EMERGENCY_ACCEPTED', onAccepted);
      socket.off('EMERGENCY_DECLINED', onDeclined);
      socket.off('DONOR_LIVE_LOCATION', onLocation);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    axios.get(`${API_URL}/api/hospital/ledger`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => setLedger(res.data || { entries: [] })).catch(() => setLedger({ entries: [] }));
  }, [token]);

  const handleCreateRequest = async () => {
    if (!token) return;
    setRequesting(true);
    setStatusMessage('');
    setAcceptedEmergency(null);
    try {
      const res = await axios.post(`${API_URL}/api/requests`, requestDraft, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequestResult(res.data);
      setStatusMessage(`Realtime broadcast sent. ${res.data.meta?.notifiedDonorCount || 0} verified donors received the emergency within 5 km.`);
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Unable to create realtime emergency.');
    } finally {
      setRequesting(false);
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
      const res = await axios.post(`${API_URL}/api/hospital/ledger/intake`, {
        abhaAddress: lookupProfile.abhaAddress,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
      <Card>
        <CardHeader>
          <Badge variant="blue"><Building2 className="h-3.5 w-3.5" />Facility Command</Badge>
          <CardTitle>Coordinate-based emergency broadcast</CardTitle>
          <CardDescription>
            Requests use your live facility point and broadcast only to compatible donors within 5 km.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Facility</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.name}</p>
          </div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">HFR ID</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.hfrFacilityId || 'Pending'}</p>
          </div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">DCGI</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.dcgiLicenseNumber || 'Not required'}</p>
          </div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Private Ledger</p>
            <p className="mt-2 text-sm font-semibold text-white">{ledger.entries?.length || 0} donors</p>
          </div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Socket Status</p>
            <p className="mt-2 text-sm font-semibold text-white">{connectionStatus === 'online' ? 'System Online' : connectionStatus === 'connecting' ? 'Connecting' : 'System Offline'}</p>
          </div>
        </CardContent>
      </Card>

      {requestResult?.request && !acceptedEmergency && (
        <Card className="border-amber-400/25 bg-[linear-gradient(180deg,rgba(146,64,14,0.20),rgba(15,23,42,0.95))]">
          <CardHeader>
            <Badge variant="saffron"><Siren className="h-3.5 w-3.5" />Pending</Badge>
            <CardTitle>Emergency request is live</CardTitle>
            <CardDescription>
              Waiting for donor action. {requestResult.meta?.notifiedDonorCount || 0} compatible donors were notified within 5 km.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Requested Group</p>
              <p className="mt-2 font-semibold text-white">{requestResult.request.bloodGroup}</p>
            </div>
            <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Urgency</p>
              <p className="mt-2 font-semibold text-white">{requestResult.request.urgency}</p>
            </div>
            <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Radius</p>
              <p className="mt-2 font-semibold text-white">{requestResult.meta?.radiusKm || 5} km</p>
            </div>
          </CardContent>
        </Card>
      )}

      {acceptedEmergency && (
        <Card className="border-emerald-400/30 bg-[linear-gradient(180deg,rgba(5,150,105,0.22),rgba(15,23,42,0.95))]">
          <CardHeader>
            <Badge variant="success"><Navigation className="h-3.5 w-3.5" />In Progress</Badge>
            <CardTitle>Hero {acceptedEmergency.donorName} is on the way!</CardTitle>
            <CardDescription>
              ETA: {acceptedEmergency.etaMinutes} mins. Blood Group: {acceptedEmergency.bloodGroup}. Live tracking is active.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1.15fr,0.85fr]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Live Coordinates</p>
                  <p className="mt-2 font-mono text-white">{formatCoord(acceptedEmergency.coordinates?.latitude)}, {formatCoord(acceptedEmergency.coordinates?.longitude)}</p>
                </div>
                <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Distance Snapshot</p>
                  <p className="mt-2 text-white">{acceptedEmergency.distanceKm || 'Live'} km from facility point</p>
                </div>
              </div>
              <div className="rounded-[1rem] border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                {statusMessage || `Hero ${acceptedEmergency.donorName} is on the way! (ETA: ${acceptedEmergency.etaMinutes} mins)`}
              </div>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),rgba(15,23,42,0.85))] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Live Map</p>
              <p className="mt-2 text-sm font-semibold text-white">Realtime donor marker</p>
              <div className="relative mt-4 h-48 overflow-hidden rounded-[1.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.45),rgba(2,6,23,0.9))]">
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px]" />
                <div className="absolute left-[20%] top-[66%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-[#ff8f1f] px-3 py-2 text-xs font-semibold text-slate-950 shadow-[0_12px_30px_rgba(255,143,31,0.32)]">
                  <Building2 className="h-3.5 w-3.5" />
                  Facility
                </div>
                <div className="absolute right-[18%] top-[30%] flex translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.28)]">
                  <MapPin className="h-3.5 w-3.5" />
                  Donor
                </div>
                <div className="absolute inset-0">
                  <svg viewBox="0 0 100 100" className="h-full w-full">
                    <path d="M 21 66 C 42 63, 56 50, 81 31" fill="none" stroke="rgba(255,255,255,0.55)" strokeDasharray="5 5" strokeWidth="1.4" />
                  </svg>
                </div>
              </div>
              <div className="mt-4 rounded-[1rem] border border-white/10 bg-white/6 p-4 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Marker Feed</p>
                <p className="mt-2">Donor at {formatCoord(acceptedEmergency.coordinates?.latitude)}, {formatCoord(acceptedEmergency.coordinates?.longitude)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Badge variant="saffron"><Siren className="h-3.5 w-3.5" />Realtime Matching</Badge>
            <CardTitle>Create emergency request</CardTitle>
            <CardDescription>
              The server uses the active facility session coordinates to compute direct donor distance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <select value={requestDraft.bloodGroup} onChange={(e) => setRequestDraft((prev) => ({ ...prev, bloodGroup: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none">
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => <option key={group} value={group} className="bg-slate-950">{group}</option>)}
              </select>
              <select value={requestDraft.urgency} onChange={(e) => setRequestDraft((prev) => ({ ...prev, urgency: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none">
                {['Critical', 'High', 'Medium', 'Low'].map((urgency) => <option key={urgency} value={urgency} className="bg-slate-950">{urgency}</option>)}
              </select>
            </div>
            <Button onClick={handleCreateRequest} size="lg" disabled={requesting}>
              {requesting ? <><Activity className="h-4 w-4 animate-spin" /> Broadcasting...</> : 'Broadcast Emergency'}
            </Button>
            {requestResult?.meta && (
              <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                Radius: {requestResult.meta.radiusKm} km. Notified donors: {requestResult.meta.notifiedDonorCount}.
              </div>
            )}
            {statusMessage && <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">{statusMessage}</div>}
          </CardContent>
        </Card>

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
              <input value={lookupValue} onChange={(e) => setLookupValue(e.target.value)} placeholder="ABHA number or address" className="flex-1 rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white placeholder:text-slate-400 outline-none" />
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

      <Card>
        <CardHeader>
          <Badge variant="subtle"><BadgeCheck className="h-3.5 w-3.5" />Registry Flow</Badge>
          <CardTitle>Matching data sources</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-300 md:grid-cols-3">
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">Blood group comes from the internal mock ABDM sandbox registry.</div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">Facility and donor positions come from saved LifeLink MongoDB coordinates plus the active socket session.</div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">Only compatible donors inside 5 km receive the INCOMING_EMERGENCY broadcast.</div>
        </CardContent>
      </Card>
    </div>
  );
}
