'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  BellRing,
  BrainCircuit,
  Building2,
  Download,
  Droplets,
  MapPinned,
  Search,
  ShieldCheck,
  Siren,
  Users,
} from 'lucide-react';
import PredictiveDemandChart from '../../../components/PredictiveDemandChart';
import { useDpi } from '../../../components/providers/DpiProvider';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';

function subscribe() {
  return () => {};
}

export default function HospitalDashboard() {
  const { proofs, summonEvents, markSummonStarted, markSummonComplete } = useDpi();
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const gatewayUser = useMemo(() => {
    if (!isClient) {
      return null;
    }
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  }, [isClient]);
  const token = useMemo(() => {
    if (!isClient) {
      return null;
    }
    return localStorage.getItem('token');
  }, [isClient]);
  const [activeSummon, setActiveSummon] = useState(null);
  const [liveFeed, setLiveFeed] = useState([]);
  const [requestDraft, setRequestDraft] = useState({ bloodGroup: 'O-', urgency: 'Critical' });
  const [requesting, setRequesting] = useState(false);
  const [requestResult, setRequestResult] = useState(null);
  const [lookupAbha, setLookupAbha] = useState('neel@abha');
  const [lookupProfile, setLookupProfile] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [ledger, setLedger] = useState({ entries: [] });
  const [statusMessage, setStatusMessage] = useState('');

  const gatewayUserId = gatewayUser?._id || null;
  const latestProof = proofs[0];
  const latestLiveSignal = liveFeed[0];
  const issueBloodEnabled = gatewayUser?.role !== 'Blood Bank' || gatewayUser?.license_type === 'DCGI_Verified';

  const summaryItems = useMemo(() => ([
    {
      label: gatewayUser?.role === 'Blood Bank' ? 'DCGI License' : 'HFR Facility ID',
      value: gatewayUser?.dcgiLicenseNumber || gatewayUser?.hfrFacilityId || 'Unavailable',
      tone: 'text-[#8bc0ff]',
    },
    {
      label: 'Current Region',
      value: gatewayUser?.currentRegion || 'south-zone',
      tone: 'text-emerald-300',
    },
    {
      label: 'Ledger Entries',
      value: String(ledger.entries?.length || 0),
      tone: 'text-[#ffbf73]',
    },
  ]), [gatewayUser, ledger.entries]);

  useEffect(() => {
    if (!gatewayUserId) {
      return;
    }

    const socket = io('http://localhost:5000');
    socket.emit('join', gatewayUserId);
    socket.emit('join-role', 'facility-command');
    socket.emit('join-region', gatewayUser.currentRegion || 'south-zone');

    socket.on('donor-live-location', (payload) => {
      setLiveFeed((prev) => [payload, ...prev].slice(0, 5));
    });

    return () => socket.disconnect();
  }, [gatewayUserId, gatewayUser?.currentRegion]);

  useEffect(() => {
    if (!token || !gatewayUserId) {
      return;
    }

    const loadLedger = async () => {
      try {
        const res = await axios.get('http://localhost:5000/api/hospital/ledger', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLedger(res.data || { entries: [] });
      } catch {
        setLedger({ entries: [] });
      }
    };

    loadLedger();
  }, [gatewayUserId, token]);

  const handleSummon = async (proof) => {
    setActiveSummon(proof.id);
    markSummonStarted(proof.id);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    markSummonComplete(proof.id);
    setActiveSummon(null);
  };

  const handleCreateRequest = async () => {
    if (!token) {
      return;
    }

    setRequesting(true);
    setStatusMessage('');
    try {
      const res = await axios.post('http://localhost:5000/api/requests', requestDraft, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequestResult(res.data);
      setStatusMessage(`Regional alert created. ${res.data.matches?.length || 0} candidates matched in ${gatewayUser?.currentRegion || 'your region'}.`);
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Regional request creation failed.');
    } finally {
      setRequesting(false);
    }
  };

  const handleLookup = async () => {
    if (!token) {
      return;
    }

    setLookupLoading(true);
    setStatusMessage('');
    try {
      const res = await axios.get(`http://localhost:5000/api/hospital/sandbox-profile/${encodeURIComponent(lookupAbha.trim().toLowerCase())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLookupProfile(res.data);
    } catch (error) {
      setLookupProfile(null);
      setStatusMessage(error.response?.data?.message || 'ABHA profile lookup failed.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleLedgerIntake = async () => {
    if (!token || !lookupProfile) {
      return;
    }

    setStatusMessage('');
    try {
      const res = await axios.post('http://localhost:5000/api/hospital/ledger/intake', {
        abhaAddress: lookupProfile.abhaAddress,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLedger(res.data);
      setStatusMessage('Donor added to the facility private ledger.');
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Could not add donor to the facility ledger.');
    }
  };

  const handleExportLedger = async () => {
    if (!token) {
      return;
    }

    try {
      const res = await axios.get('http://localhost:5000/api/hospital/ledger/export', {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(gatewayUser?.name || 'facility').replace(/\s+/g, '-').toLowerCase()}-drive-data.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatusMessage('Facility ledger exported successfully.');
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Ledger export failed.');
    }
  };

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden border-[#0b4ea2]/25">
        <CardContent className="grid-shell relative grid gap-6 p-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="absolute left-0 top-0 h-full w-full bg-[radial-gradient(circle_at_top_right,rgba(255,143,31,0.16),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(11,78,162,0.18),transparent_34%)]" />
          <div className="relative">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Badge variant="blue" className="mb-0">
                <Building2 className="h-3.5 w-3.5" />
                {gatewayUser?.role === 'Blood Bank' ? 'Blood Bank Command Center' : 'Hospital Command Center'}
              </Badge>
              {gatewayUser?.verificationBadge && (
                <Badge variant="success">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  {gatewayUser.verificationBadge}
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">Regional dispatch and facility-owned donor CRM</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">This command center creates Red Alerts directly over Socket.io, receives live donor coordinates after ZK-backed clearance, and stores every drive in a private facility ledger.</p>
            <div className="mt-7 grid gap-4 sm:grid-cols-3">
              {summaryItems.map((item) => (
                <div key={item.label} className="rounded-[1.35rem] border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                  <p className={`mt-2 text-lg font-semibold ${item.tone}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative rounded-[1.7rem] border border-[#ff8f1f]/25 bg-[linear-gradient(180deg,rgba(255,143,31,0.16),rgba(255,143,31,0.05))] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-[#ffd19e]">AI Foresight</p>
                <h2 className="mt-3 text-xl font-semibold text-white">Predicted dengue-driven O-ve spike</h2>
              </div>
              <div className="rounded-2xl bg-slate-950/25 p-3">
                <BrainCircuit className="h-6 w-6 text-[#ffbf73]" />
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-100">The command center prioritizes O-ve inventory staging and summons pre-cleared donors before the demand curve peaks.</p>
            {gatewayUser?.facilityAddress && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/25 p-4 text-sm text-slate-200">
                Verified address: {gatewayUser.facilityAddress}
              </div>
            )}
            {gatewayUser?.role === 'Blood Bank' && (
              <div className={`mt-4 rounded-2xl border p-4 text-sm ${issueBloodEnabled ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-amber-400/25 bg-amber-500/10 text-amber-100'}`}>
                {issueBloodEnabled ? 'DCGI_Verified license detected. Issue Blood workflow is enabled.' : 'Issue Blood is locked until license_type is DCGI_Verified.'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <Badge variant="saffron">
              <BrainCircuit className="h-3.5 w-3.5" />
              Predictive Demand Dashboard
            </Badge>
            <CardTitle>O-ve demand expected to surge within the next 24 hours</CardTitle>
            <CardDescription>Simulated outbreak intelligence pushes the command center into proactive donor mobilization.</CardDescription>
          </CardHeader>
          <CardContent>
            <PredictiveDemandChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="blue">
              <ShieldCheck className="h-3.5 w-3.5" />
              Direct Authorization
            </Badge>
            <CardTitle>Pre-Verified Donor Profile</CardTitle>
            <CardDescription>Identity remains hidden. Only blood group and proof-backed clearance are visible to the facility.</CardDescription>
          </CardHeader>
          <CardContent>
            {latestProof ? (
              <motion.div layout className="space-y-4 rounded-[1.6rem] border border-emerald-400/28 bg-emerald-500/10 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-100/80">Name Hidden</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">{latestProof.alias}</h3>
                    <p className="mt-2 text-sm text-slate-200">{latestProof.destination} / {latestProof.hospitalWing || 'Regional Dispatch'}</p>
                  </div>
                  <ShieldCheck className="h-12 w-12 text-emerald-300" />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs text-slate-400">Blood Group</p>
                    <p className="mt-2 text-lg font-semibold text-white">{latestProof.bloodGroup}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs text-slate-400">ZKP Status</p>
                    <p className="mt-2 text-sm font-semibold text-emerald-300">{latestProof.zkStatus}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4">
                  <p className="text-xs text-slate-400">Proof Hash</p>
                  <p className="mt-2 break-all font-mono text-xs text-[#8bc0ff]">{latestProof.proofHash}</p>
                </div>

                <Button variant="success" size="lg" className="w-full" onClick={() => handleSummon(latestProof)} disabled={activeSummon === latestProof.id || latestProof.summonStatus === 'dispatched'}>
                  {activeSummon === latestProof.id ? <><Activity className="h-4 w-4 animate-spin" /> Dispatching to facility ops...</> : latestProof.summonStatus === 'dispatched' ? <><BadgeCheck className="h-4 w-4" /> Verify & Summon Complete</> : <><BellRing className="h-4 w-4" /> Verify & Summon</>}
                </Button>
              </motion.div>
            ) : (
              <div className="rounded-[1.6rem] border border-dashed border-white/12 bg-white/4 p-8 text-center">
                <ShieldCheck className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-4 text-sm font-medium text-slate-200">Awaiting donor proof</p>
                <p className="mt-2 text-sm text-slate-400">Generate a proof from the donor dashboard to populate this pre-verified profile.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Badge variant="blue">
              <Siren className="h-3.5 w-3.5" />
              Regional Broadcast
            </Badge>
            <CardTitle>Create a direct region-room Red Alert</CardTitle>
            <CardDescription>Hospitals and blood banks now broadcast directly to every active donor in the same region.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <select value={requestDraft.bloodGroup} onChange={(e) => setRequestDraft((prev) => ({ ...prev, bloodGroup: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none">
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => (
                  <option key={group} value={group} className="bg-slate-900">{group}</option>
                ))}
              </select>
              <select value={requestDraft.urgency} onChange={(e) => setRequestDraft((prev) => ({ ...prev, urgency: e.target.value }))} className="rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none">
                {['Critical', 'High', 'Medium'].map((urgency) => (
                  <option key={urgency} value={urgency} className="bg-slate-900">{urgency}</option>
                ))}
              </select>
            </div>
            <Button onClick={handleCreateRequest} className="w-full" disabled={requesting}>
              {requesting ? <><Activity className="h-4 w-4 animate-spin" /> Broadcasting...</> : <><Siren className="h-4 w-4" /> Broadcast Regional Red Alert</>}
            </Button>
            {requestResult && (
              <div className="rounded-[1.4rem] border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                Matching engine prepared {requestResult.matches?.length || 0} region-qualified candidates for this request.
              </div>
            )}
            {statusMessage && (
              <div className="rounded-[1.4rem] border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">{statusMessage}</div>
            )}
            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              Socket room: <span className="font-semibold text-white">{gatewayUser?.currentRegion || 'south-zone'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="blue">
              <MapPinned className="h-3.5 w-3.5" />
              Live Donor Tracking
            </Badge>
            <CardTitle>Real-time donor coordinates and ETA</CardTitle>
            <CardDescription>Live location arrives immediately after a donor clears the 90-day history and proof checks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {liveFeed.length > 0 ? liveFeed.map((item, index) => (
              <div key={`${item.donorAlias}-${index}`} className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-semibold text-white">{item.donorAlias} • {item.abhaStatus}</p>
                <p className="mt-2 text-sm text-slate-300">{item.requestTitle}</p>
                <p className="mt-2 text-xs text-slate-400">ETA {item.etaMinutes} min • {item.coordinates.latitude}, {item.coordinates.longitude}</p>
              </div>
            )) : (
              <div className="rounded-[1.4rem] border border-dashed border-white/12 bg-white/4 p-6 text-sm text-slate-400">No live donor coordinates yet. Accept a request from the citizen dashboard to stream the feed here.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <Badge variant="blue">
              <Users className="h-3.5 w-3.5" />
              Facility CRM
            </Badge>
            <CardTitle>Drive intake and private donor ledger</CardTitle>
            <CardDescription>Facilities can fetch mock ABHA profiles and add them to a ledger owned only by that facility.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <input value={lookupAbha} onChange={(e) => setLookupAbha(e.target.value)} placeholder="Enter ABHA ID" className="flex-1 rounded-[1rem] border border-white/10 bg-white/6 px-4 py-3 text-white placeholder:text-slate-400 outline-none" />
              <Button onClick={handleLookup} disabled={lookupLoading}>
                {lookupLoading ? <Activity className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Lookup
              </Button>
            </div>

            {lookupProfile && (
              <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-semibold text-white">{lookupProfile.name} • {lookupProfile.abhaAddress}</p>
                <p className="mt-2 text-sm text-slate-300">{lookupProfile.bloodGroup || 'Blood group pending'} • {lookupProfile.verificationTier}</p>
                <p className="mt-2 text-xs text-slate-400">Verification source: {lookupProfile.verificationSourceId || 'Not supplied'} • Region: {lookupProfile.currentRegion}</p>
                <Button onClick={handleLedgerIntake} className="mt-4 w-full">
                  <Droplets className="h-4 w-4" />
                  Add to Facility Ledger
                </Button>
              </div>
            )}

            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Private Ledger</p>
                  <p className="mt-1 text-xs text-slate-400">{ledger.entries?.length || 0} donors added during this drive.</p>
                </div>
                <Button variant="secondary" onClick={handleExportLedger} className="bg-white/10 text-white hover:bg-white/15">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </div>
              <div className="space-y-3">
                {(ledger.entries?.length || 0) > 0 ? ledger.entries.slice(0, 5).map((entry) => (
                  <div key={entry._id || entry.abhaAddress} className="rounded-[1rem] border border-white/10 bg-slate-950/25 p-3">
                    <p className="text-sm font-semibold text-white">{entry.donorName}</p>
                    <p className="mt-1 text-xs text-slate-300">{entry.abhaAddress} • {entry.bloodGroup || 'Pending group'}</p>
                    <p className="mt-1 text-xs text-slate-400">{entry.verificationTier}</p>
                  </div>
                )) : (
                  <div className="rounded-[1rem] border border-dashed border-white/12 bg-white/4 p-4 text-sm text-slate-400">No donors have been added to this facility ledger yet.</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="saffron">
              <ArrowUpRight className="h-3.5 w-3.5" />
              Dispatch Layer
            </Badge>
            <CardTitle>Regional dispatch and summon audit</CardTitle>
            <CardDescription>Summon actions are logged locally while the live donor ETA stream keeps updating.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-[1.6rem] border border-white/10 bg-slate-950/30 p-5">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Destination</p>
                  <p className="mt-2 text-base font-semibold text-white">{latestProof?.destination || gatewayUser?.name || 'Regional Facility'}</p>
                </div>
                <ArrowUpRight className="h-5 w-5 text-[#8bc0ff]" />
              </div>

              <div className="space-y-4 pt-4 text-sm text-slate-200">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Latest Live ETA</p>
                  <p className="mt-2 leading-6">{latestLiveSignal ? `${latestLiveSignal.donorAlias} arriving in ${latestLiveSignal.etaMinutes} minutes for ${latestLiveSignal.requestTitle}.` : 'Awaiting a donor acceptance event from the regional room.'}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Route Link</p>
                  <p className="mt-2 break-all font-mono text-xs text-[#8bc0ff]">{latestProof?.mapLink || 'https://maps.google.com/?q=Apex+City+Hospital'}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Summon Audit</p>
                  {(summonEvents.length > 0) ? (
                    <div className="mt-2 space-y-2">
                      {summonEvents.slice(0, 3).map((event) => (
                        <p key={event.id} className="text-sm text-slate-200">{event.message}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-emerald-300">ZKP clearance valid, donor identity withheld, summon ready.</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
