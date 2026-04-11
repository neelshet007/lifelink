'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Crosshair, MapPin, Navigation, Siren, XCircle } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { getRealtimeSocket } from '../lib/realtime';
import { getStoredUser } from '../lib/session';
import {
  clearEmergency,
  getSocketStoreState,
  patchActiveEmergency,
  setEmergencyDrawerOpen,
  socketStoreSubscribe,
} from '../lib/socketStore';

function subscribe(callback) {
  return socketStoreSubscribe(callback);
}

function formatCoord(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(5) : '--';
}

export default function EmergencyActionDock() {
  const { activeEmergency, emergencyDrawerOpen, navigationMode } = useSyncExternalStore(
    subscribe,
    getSocketStoreState,
    getSocketStoreState
  );
  const user = useMemo(() => getStoredUser(), []);
  const [actioning, setActioning] = useState(false);

  if (user?.role !== 'User' || !activeEmergency) {
    return null;
  }

  const handleAction = async (type) => {
    setActioning(true);
    try {
      const socket = getRealtimeSocket();
      const payload = {
        requestId: activeEmergency.requestId,
        donorId: user?._id || user?.id,
      };

      if (type === 'accept') {
        socket.emit('DONOR_ACCEPTED', payload);
        patchActiveEmergency(
          {
            responseStatus: 'accepted',
            acceptedAt: new Date().toISOString(),
          },
          { navigationMode: true, emergencyDrawerOpen: true }
        );
        return;
      }

      socket.emit('DONOR_DECLINED', payload);
      clearEmergency(activeEmergency.requestId);
    } finally {
      setActioning(false);
    }
  };

  if (!emergencyDrawerOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-[70]">
        <button
          type="button"
          onClick={() => setEmergencyDrawerOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/20 px-4 py-3 text-sm font-semibold text-red-50 shadow-[0_18px_48px_rgba(127,29,29,0.3)] backdrop-blur-xl"
        >
          <Siren className="h-4 w-4" />
          Emergency Action Tab
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-4 sm:px-6 lg:px-8">
      <Card className="mx-auto w-full max-w-5xl border-red-400/30 bg-[linear-gradient(180deg,rgba(127,29,29,0.38),rgba(15,23,42,0.96))]">
        <CardHeader className="gap-3 border-b border-white/10 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <Badge variant={navigationMode ? 'success' : 'saffron'}>
                {navigationMode ? <Navigation className="h-3.5 w-3.5" /> : <Siren className="h-3.5 w-3.5" />}
                {navigationMode ? 'Navigation Mode' : 'Incoming Emergency'}
              </Badge>
              <CardTitle className="text-xl">
                {activeEmergency.hospital} needs {activeEmergency.bloodGroup}
              </CardTitle>
              <CardDescription>
                {activeEmergency.hospitalType} alert. Distance {activeEmergency.distanceKm ?? activeEmergency.distance ?? 'Live'} km. Urgency {activeEmergency.urgency}.
              </CardDescription>
            </div>
            <button type="button" className="text-sm text-slate-300 underline" onClick={() => setEmergencyDrawerOpen(false)}>
              Hide tab
            </button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-50">
              {activeEmergency.message}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1rem] border border-white/10 bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Hospital</p>
                <p className="mt-2 text-sm font-semibold text-white">{activeEmergency.hospital}</p>
              </div>
              <div className="rounded-[1rem] border border-white/10 bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Type</p>
                <p className="mt-2 text-sm font-semibold text-white">{activeEmergency.hospitalType}</p>
              </div>
              <div className="rounded-[1rem] border border-white/10 bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Distance</p>
                <p className="mt-2 text-sm font-semibold text-white">{activeEmergency.distanceKm ?? activeEmergency.distance ?? '--'} km</p>
              </div>
            </div>
            {activeEmergency.responseStatus !== 'accepted' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Button variant="success" size="lg" onClick={() => handleAction('accept')} disabled={actioning}>
                  <CheckCircle2 className="h-4 w-4" />
                  Accept
                </Button>
                <Button variant="secondary" size="lg" onClick={() => handleAction('decline')} disabled={actioning}>
                  <XCircle className="h-4 w-4" />
                  Decline
                </Button>
              </div>
            ) : (
              <div className="rounded-[1rem] border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                Response locked in. Navigation mode is active and your live position is being streamed to the hospital.
              </div>
            )}
          </div>
          <div className="rounded-[1.4rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),rgba(15,23,42,0.85))] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Live Route</p>
                <p className="mt-2 text-sm font-semibold text-white">Hospital destination map</p>
              </div>
              {activeEmergency.mapLink && (
                <a href={activeEmergency.mapLink} target="_blank" rel="noreferrer" className="text-sm text-[#8bc0ff] underline">
                  Open map
                </a>
              )}
            </div>
            <div className="relative mt-4 h-48 overflow-hidden rounded-[1.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.45),rgba(2,6,23,0.9))]">
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px]" />
              <div className="absolute left-[22%] top-[68%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-[#0b4ea2] px-3 py-2 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(11,78,162,0.34)]">
                <Crosshair className="h-3.5 w-3.5" />
                You
              </div>
              <div className="absolute right-[18%] top-[28%] flex translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-[#ff8f1f] px-3 py-2 text-xs font-semibold text-slate-950 shadow-[0_12px_30px_rgba(255,143,31,0.32)]">
                <MapPin className="h-3.5 w-3.5" />
                {activeEmergency.hospital}
              </div>
              <div className="absolute inset-0">
                <svg viewBox="0 0 100 100" className="h-full w-full">
                  <path d="M 24 67 C 44 64, 56 48, 81 29" fill="none" stroke="rgba(255,255,255,0.55)" strokeDasharray="5 5" strokeWidth="1.4" />
                </svg>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1rem] border border-white/10 bg-white/6 p-4 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Hospital Coordinates</p>
                <p className="mt-2 font-mono text-white">{formatCoord(activeEmergency.hospitalCoords?.latitude)}, {formatCoord(activeEmergency.hospitalCoords?.longitude)}</p>
              </div>
              <div className="rounded-[1rem] border border-white/10 bg-white/6 p-4 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</p>
                <p className="mt-2 font-semibold text-white">{navigationMode ? 'En route to facility' : 'Awaiting donor action'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
