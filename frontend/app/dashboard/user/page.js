'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { Activity, MapPin, Navigation, Radio, Siren } from 'lucide-react';
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

export default function UserDashboard() {
  const { activeEmergency, navigationMode, connectionStatus, meshAlerts, requestConfirmed } = useSyncExternalStore(
    subscribe,
    getSocketStoreState,
    getSocketStoreState
  );
  const user = useMemo(() => getStoredUser(), []);
  const token = useMemo(() => getToken(), []);

  const [requestDraft, setRequestDraft] = useState({ bloodGroup: user?.bloodGroup || 'O+', urgency: 'Critical', bloodUnits: 1 });
  const [requestStatus, setRequestStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [meshBroadcasting, setMeshBroadcasting] = useState(false);
  const [activeTab, setActiveTab] = useState('status');

  const handleCreateRequest = async () => {
    if (!token) return;
    setSubmitting(true);
    setRequestStatus('');
    try {
      const res = await axios.post(`${API_URL}/api/requests`, requestDraft, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequestStatus(`Emergency created. ${res.data.meta?.notifiedCount || 0} mesh nodes reached in your radius.`);
    } catch (error) {
      setRequestStatus(error.response?.data?.message || 'Unable to create emergency request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSocketBroadcast = () => {
    const socket = getRealtimeSocket();
    setMeshBroadcasting(true);
    socket.emit('REQUEST_BLOOD', {
      bloodGroup: requestDraft.bloodGroup,
      bloodUnits: requestDraft.bloodUnits || 1,
      urgency: requestDraft.urgency,
      requestType: 'Blood Request',
    });
    setRequestStatus('⚡ Instant mesh broadcast sent — hospitals and blood banks will see your request immediately.');
    setTimeout(() => setMeshBroadcasting(false), 3000);
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-2 rounded-[1rem] bg-white/5 p-1 border border-white/10">
          <TabsTrigger value="status" className="rounded-[0.8rem] transition-all">My Status</TabsTrigger>
          <TabsTrigger value="mesh" className="rounded-[0.8rem] transition-all relative">
            Mesh Alerts
            {meshAlerts?.length > 0 && (
              <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {meshAlerts.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── MY STATUS ────────────────────────────────────────────────────────── */}
        <TabsContent value="status" className="space-y-6">

          {/* REQUEST_CONFIRMED — when a facility/donor responds to user's request */}
          {requestConfirmed && (
            <div className="rounded-[1.2rem] border border-emerald-400/30 bg-emerald-500/10 p-4 flex items-center gap-3">
              <Radio className="h-5 w-5 text-emerald-400 animate-pulse shrink-0" />
              <div>
                <p className="font-semibold text-emerald-300">{requestConfirmed.message}</p>
                <p className="text-xs text-slate-400 mt-0.5">From: {requestConfirmed.responderName} · {requestConfirmed.responderRole}</p>
              </div>
            </div>
          )}

          {/* Profile stats */}
          <Card>
            <CardHeader>
              <Badge variant="blue">Live Pulse</Badge>
              <CardTitle>Point-to-point donor console</CardTitle>
              <CardDescription>
                Your emergency feed is driven by realtime sockets, verified blood group data, and a strict 5 km radius.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              {[
                ['ABHA', user?.abhaAddress || 'Not linked'],
                ['Verified Blood Group', user?.bloodGroup || 'Pending verification'],
                ['Socket Status', connectionStatus === 'online' ? 'System Online' : connectionStatus === 'connecting' ? 'Connecting' : 'System Offline'],
                ['Realtime Radius', '5 km emergency scan'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
                  <p className="mt-2 text-sm font-semibold text-white">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Active emergency card (for user's own accepted request) */}
          {activeEmergency && (
            <Card className={navigationMode
              ? 'border-emerald-400/30 bg-[linear-gradient(180deg,rgba(5,150,105,0.22),rgba(15,23,42,0.95))]'
              : 'border-red-400/30 bg-[linear-gradient(180deg,rgba(127,29,29,0.35),rgba(15,23,42,0.95))]'
            }>
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
                {[
                  ['Facility', activeEmergency.hospital],
                  ['Type', activeEmergency.hospitalType || activeEmergency.senderType],
                  ['Distance Snapshot', `${activeEmergency.distanceKm ?? activeEmergency.distance ?? '--'} km`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[1rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
                    <p className="mt-2 font-semibold text-white inline-flex items-center gap-2">
                      {label === 'Distance Snapshot' && <MapPin className="h-4 w-4 text-[#8bc0ff]" />}
                      {value}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Create your own request */}
          <Card>
            <CardHeader>
              <Badge variant="blue">Patient Request</Badge>
              <CardTitle>Broadcast a blood emergency</CardTitle>
              <CardDescription>
                Hospitals and blood banks within 10 km, and compatible donors within 5 km, will be notified instantly.
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
                  placeholder="Units needed"
                  className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  onClick={handleSocketBroadcast}
                  size="lg"
                  disabled={meshBroadcasting}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {meshBroadcasting
                    ? <><Activity className="h-4 w-4 animate-spin" /> Sending...</>
                    : <><Radio className="h-4 w-4" /> ⚡ Instant Mesh Broadcast</>
                  }
                </Button>
                <Button onClick={handleCreateRequest} size="lg" variant="secondary" disabled={submitting}>
                  {submitting ? <><Activity className="h-4 w-4 animate-spin" /> Dispatching...</> : 'REST Request + DB'}
                </Button>
              </div>
              {requestStatus && (
                <div className="rounded-[1rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  {requestStatus}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── MESH ALERTS ─────────────────────────────────────────────────────── */}
        <TabsContent value="mesh" className="space-y-4">
          <Card className="border-amber-400/20 bg-[linear-gradient(180deg,rgba(146,64,14,0.12),rgba(15,23,42,0.95))]">
            <CardHeader>
              <Badge variant="saffron"><Radio className="h-3.5 w-3.5 animate-pulse" />Live Mesh Feed</Badge>
              <CardTitle>Incoming requests from nearby facilities</CardTitle>
              <CardDescription>
                Hospitals and Blood Banks within 5 km appear here. Click ACCEPT AS DONOR to respond and start navigation.
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
