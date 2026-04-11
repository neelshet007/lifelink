'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { Activity, MapPin, Navigation, Siren } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { API_URL, getStoredUser, getToken } from '../../../lib/session';
import { getSocketStoreState, socketStoreSubscribe } from '../../../lib/socketStore';

function subscribe(callback) {
  return socketStoreSubscribe(callback);
}

export default function UserDashboard() {
  const { activeEmergency, navigationMode, connectionStatus } = useSyncExternalStore(
    subscribe,
    getSocketStoreState,
    getSocketStoreState
  );
  const user = useMemo(() => getStoredUser(), []);
  const token = useMemo(() => getToken(), []);
  const [requestDraft, setRequestDraft] = useState({ bloodGroup: user?.bloodGroup || 'O+', urgency: 'Critical' });
  const [requestStatus, setRequestStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleCreateRequest = async () => {
    if (!token) return;
    setSubmitting(true);
    setRequestStatus('');
    try {
      const res = await axios.post(`${API_URL}/api/requests`, requestDraft, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequestStatus(`Emergency created. ${res.data.meta?.notifiedDonorCount || 0} live donors were reached within 5 km.`);
    } catch (error) {
      setRequestStatus(error.response?.data?.message || 'Unable to create emergency request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Badge variant="blue">Live Pulse</Badge>
          <CardTitle>Point-to-point donor console</CardTitle>
          <CardDescription>
            Your emergency feed is driven by realtime sockets, verified blood group data, and a strict 5 km radius.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">ABHA</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.abhaAddress || 'Not linked'}</p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Verified Blood Group</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.bloodGroup || 'Pending verification'}</p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Socket Status</p>
            <p className="mt-2 text-sm font-semibold text-white">{connectionStatus === 'online' ? 'System Online' : connectionStatus === 'connecting' ? 'Connecting' : 'System Offline'}</p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Realtime Radius</p>
            <p className="mt-2 text-sm font-semibold text-white">5 km emergency scan</p>
          </div>
        </CardContent>
      </Card>

      {activeEmergency && (
        <Card className={navigationMode ? 'border-emerald-400/30 bg-[linear-gradient(180deg,rgba(5,150,105,0.22),rgba(15,23,42,0.95))]' : 'border-red-400/30 bg-[linear-gradient(180deg,rgba(127,29,29,0.35),rgba(15,23,42,0.95))]'}>
          <CardHeader>
            <Badge variant={navigationMode ? 'success' : 'saffron'}>
              {navigationMode ? <Navigation className="h-3.5 w-3.5" /> : <Siren className="h-3.5 w-3.5" />}
              {navigationMode ? 'Navigation Mode' : 'Emergency Hot'}
            </Badge>
            <CardTitle>{activeEmergency.hospital} needs {activeEmergency.bloodGroup}</CardTitle>
            <CardDescription>
              {navigationMode
                ? 'You accepted this request. Your live location stream is active for the hospital dashboard.'
                : `Emergency tab is pinned. Distance: ${activeEmergency.distanceKm ?? activeEmergency.distance} km. Urgency: ${activeEmergency.urgency}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Facility</p>
              <p className="mt-2 font-semibold text-white">{activeEmergency.hospital}</p>
            </div>
            <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Type</p>
              <p className="mt-2 font-semibold text-white">{activeEmergency.hospitalType || activeEmergency.requesterRole}</p>
            </div>
            <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Distance Snapshot</p>
              <p className="mt-2 inline-flex items-center gap-2 font-semibold text-white"><MapPin className="h-4 w-4 text-[#8bc0ff]" /> {activeEmergency.distanceKm ?? activeEmergency.distance ?? '--'} km</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <Badge variant="blue">Patient Request</Badge>
          <CardTitle>Create your own emergency</CardTitle>
          <CardDescription>
            Hospitals and blood banks will use your saved LifeLink coordinates, not area labels, to match in real time.
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
          <Button onClick={handleCreateRequest} size="lg" disabled={submitting}>
            {submitting ? <><Activity className="h-4 w-4 animate-spin" /> Dispatching...</> : 'Create Emergency Request'}
          </Button>
          {requestStatus && <div className="rounded-[1rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">{requestStatus}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="subtle">Emergency Rule</Badge>
          <CardTitle>What changed</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-300 md:grid-cols-3">
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">Incoming emergency events are now handled globally, so the action tab appears without refreshing the page.</div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">Your live coordinates are synced on login and refreshed while the dashboard stays open.</div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 inline-flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-[#8bc0ff]" /> Only matching donors within 5 km are notified.</div>
        </CardContent>
      </Card>
    </div>
  );
}
