'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { Activity, CheckCircle2, MapPin, Siren, XCircle } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { activeEmergencyStoreSubscribe, getActiveEmergencyState, setActiveEmergency, setEmergencyDrawerOpen } from '../../../lib/activeEmergencyStore';
import { getRealtimeSocket } from '../../../lib/realtime';
import { API_URL, getStoredUser, getToken } from '../../../lib/session';

function subscribe(callback) {
  return activeEmergencyStoreSubscribe(callback);
}

export default function UserDashboard() {
  const { activeEmergency, emergencyDrawerOpen } = useSyncExternalStore(subscribe, getActiveEmergencyState, getActiveEmergencyState);
  const user = useMemo(() => getStoredUser(), []);
  const token = useMemo(() => getToken(), []);
  const [requestDraft, setRequestDraft] = useState({ bloodGroup: user?.bloodGroup || 'O+', urgency: 'Critical' });
  const [requestStatus, setRequestStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actioning, setActioning] = useState(false);

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

  const handleEmergencyAction = async (type) => {
    if (!activeEmergency) return;
    setActioning(true);
    try {
      const socket = getRealtimeSocket();
      socket.emit(type === 'accept' ? 'accept_request' : 'decline_request', { requestId: activeEmergency.requestId });
      if (type === 'decline') {
        setActiveEmergency(null);
      }
      if (type === 'accept') {
        setEmergencyDrawerOpen(true);
      }
    } finally {
      setActioning(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Badge variant="blue">Live Pulse</Badge>
          <CardTitle>Point-to-point donor console</CardTitle>
          <CardDescription>
            Your emergency feed is now driven by real-time coordinates, verified blood group data, and a strict 5 km radius.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">ABHA</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.abhaAddress || 'Not linked'}</p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Verified Blood Group</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.bloodGroup || 'Pending verification'}</p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Realtime Radius</p>
            <p className="mt-2 text-sm font-semibold text-white">5 km emergency scan</p>
          </div>
        </CardContent>
      </Card>

      {activeEmergency && emergencyDrawerOpen && (
        <Card className="border-red-400/30 bg-[linear-gradient(180deg,rgba(127,29,29,0.35),rgba(15,23,42,0.95))]">
          <CardHeader>
            <Badge variant="saffron"><Siren className="h-3.5 w-3.5" />Incoming Emergency</Badge>
            <CardTitle>{activeEmergency.hospital} needs {activeEmergency.bloodGroup}</CardTitle>
            <CardDescription>
              Immediate red alert opened automatically. Distance: {activeEmergency.distance} km. Urgency: {activeEmergency.urgency}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[1.25rem] border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-50">
              {activeEmergency.message}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Button variant="success" size="lg" onClick={() => handleEmergencyAction('accept')} disabled={actioning}>
                <CheckCircle2 className="h-4 w-4" />
                Accept Emergency
              </Button>
              <Button variant="secondary" size="lg" onClick={() => handleEmergencyAction('decline')} disabled={actioning}>
                <XCircle className="h-4 w-4" />
                Decline
              </Button>
            </div>
            <button type="button" className="text-sm text-slate-300 underline" onClick={() => setEmergencyDrawerOpen(false)}>
              Hide panel for now
            </button>
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
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">Legacy area buckets are no longer used for matching.</div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4">Your live coordinates are synced on login and refreshed while the dashboard stays open.</div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-4 inline-flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-[#8bc0ff]" /> Only matching donors within 5 km are notified.</div>
        </CardContent>
      </Card>
    </div>
  );
}
