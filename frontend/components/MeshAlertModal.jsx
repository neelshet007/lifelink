'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Hospital,
  Package,
  Siren,
  User as UserIcon,
  X,
  XCircle,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { getRealtimeSocket } from '../lib/realtime';
import { getStoredUser } from '../lib/session';
import {
  clearRequestConfirmed,
  getSocketStoreState,
  removeMeshAlert,
  socketStoreSubscribe,
} from '../lib/socketStore';

function subscribe(cb) {
  return socketStoreSubscribe(cb);
}

const URGENCY_BORDER = {
  Critical: 'border-red-500/40 shadow-[0_0_60px_rgba(239,68,68,0.18)]',
  Immediate: 'border-amber-500/40 shadow-[0_0_60px_rgba(245,158,11,0.16)]',
  Standard: 'border-blue-500/40 shadow-[0_0_60px_rgba(59,130,246,0.14)]',
};

const URGENCY_BADGE = {
  Critical: 'saffron',
  Immediate: 'subtle',
  Standard: 'blue',
};

const ROLE_ICON = {
  Hospital,
  'Blood Bank': Building2,
  User: UserIcon,
};

// ── Modal: shown one alert at a time, user can step through them ─────────────
export default function MeshAlertModal() {
  const { meshAlerts, requestConfirmed } = useSyncExternalStore(
    subscribe,
    getSocketStoreState,
    getSocketStoreState
  );
  const currentUser = useMemo(() => getStoredUser(), []);

  // Which alert is currently shown (index into meshAlerts)
  const [viewIndex, setViewIndex] = useState(0);
  const [actioning, setActioning] = useState(false);
  // Local "accepted" state so button turns green immediately
  const [accepted, setAccepted] = useState(null); // requestId

  // Keep viewIndex in bounds when alerts shrink
  useEffect(() => {
    if (meshAlerts.length > 0 && viewIndex >= meshAlerts.length) {
      setViewIndex(meshAlerts.length - 1);
    }
  }, [meshAlerts.length, viewIndex]);

  // ── Nothing to show ─────────────────────────────────────────────────────────
  if (!meshAlerts || meshAlerts.length === 0) {
    // Still show the REQUEST_CONFIRMED toast if present
    if (!requestConfirmed) return null;
    return (
      <ConfirmationToast confirmed={requestConfirmed} />
    );
  }

  const alert = meshAlerts[viewIndex];
  if (!alert) return null;

  const isFacility = currentUser?.role === 'Hospital' || currentUser?.role === 'Blood Bank';
  const isUser = currentUser?.role === 'User';
  const SenderIcon = ROLE_ICON[alert.senderType] || Siren;
  const borderClass = URGENCY_BORDER[alert.urgency] || URGENCY_BORDER.Standard;
  const isAlreadyAccepted = accepted === alert.requestId;

  const handleFacilityAccept = () => {
    setActioning(true);
    const socket = getRealtimeSocket();
    socket.emit('FACILITY_ACCEPTED_REQUEST', {
      requestId: alert.requestId,
      bloodGroup: alert.bloodGroup,
      bloodUnits: alert.bloodUnits,
      responderName: currentUser?.name,
      responderRole: currentUser?.role,
    });
    setAccepted(alert.requestId);
    setActioning(false);
    // Remove alert after short delay so user sees the confirmation
    setTimeout(() => {
      removeMeshAlert(alert.requestId);
      setViewIndex(0);
    }, 1500);
  };

  const handleDonorAccept = () => {
    setActioning(true);
    const socket = getRealtimeSocket();
    const userId = currentUser?._id || currentUser?.id;
    socket.emit('DONOR_ACCEPTED_REQUEST', {
      requestId: alert.requestId,
      donorId: userId,
      responderName: currentUser?.name,
      responderRole: 'User',
    });
    socket.emit('DONOR_ACCEPTED', { requestId: alert.requestId, donorId: userId });
    setAccepted(alert.requestId);
    setActioning(false);
    setTimeout(() => {
      removeMeshAlert(alert.requestId);
      setViewIndex(0);
    }, 1500);
  };

  const handleDismiss = () => {
    const socket = getRealtimeSocket();
    const userId = currentUser?._id || currentUser?.id;
    socket.emit('DONOR_DECLINED', { requestId: alert.requestId, donorId: userId });
    removeMeshAlert(alert.requestId);
    setViewIndex((prev) => Math.max(0, prev - 1));
  };

  return (
    <>
      {/* REQUEST_CONFIRMED toast — shown alongside the modal */}
      {requestConfirmed && <ConfirmationToast confirmed={requestConfirmed} />}

      {/* ── Full-screen dark overlay ───────────────────────────────────────── */}
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div
          className={`relative w-full max-w-lg rounded-[2rem] border bg-[linear-gradient(160deg,rgba(10,18,35,0.98),rgba(5,10,25,0.99))] backdrop-blur-2xl p-0 overflow-hidden ${borderClass}`}
        >
          {/* Urgency glow ring */}
          {alert.urgency === 'Critical' && (
            <div className="absolute inset-0 rounded-[2rem] border border-red-500/20 animate-pulse pointer-events-none" />
          )}

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 px-7 pt-6 pb-4 border-b border-white/8">
            <div className="flex items-center gap-3">
              <SenderIcon className="h-5 w-5 text-slate-300" />
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  {alert.senderType} · {alert.distanceKm ?? alert.distance ?? '?'} km away
                </p>
                <p className="font-bold text-white text-lg leading-tight mt-0.5">
                  {/* senderName is 100% the OTHER entity, never the logged-in user */}
                  {alert.senderName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {meshAlerts.length > 1 && (
                <span className="text-xs font-semibold text-slate-400">
                  {viewIndex + 1}/{meshAlerts.length}
                </span>
              )}
              <button
                onClick={handleDismiss}
                className="rounded-full p-2 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Body ───────────────────────────────────────────────────────── */}
          <div className="px-7 py-6 space-y-5">
            {/* What's needed */}
            <div className="flex items-center gap-4">
              <div className={`h-20 w-20 rounded-2xl flex flex-col items-center justify-center font-extrabold text-2xl border ${URGENCY_BORDER[alert.urgency] || URGENCY_BORDER.Standard} bg-white/5`}>
                {alert.bloodGroup}
                <span className="text-[10px] font-normal text-slate-400 mt-0.5">
                  {alert.bloodUnits || 1} unit{alert.bloodUnits > 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Help Needed By</p>
                <p className="font-semibold text-white text-base">{alert.senderName}</p>
                <p className="text-sm text-slate-400">{alert.senderType}</p>
                <Badge variant={URGENCY_BADGE[alert.urgency] || 'subtle'}>
                  <AlertTriangle className="h-3 w-3" />{alert.urgency}
                </Badge>
              </div>
            </div>

            {/* Message */}
            <div className="rounded-[1rem] border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-300">
              {alert.message}
            </div>

            {/* CTA */}
            {isAlreadyAccepted ? (
              <div className="flex items-center gap-3 rounded-[1rem] border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="font-semibold">
                  {isFacility ? 'Stock allocated — request confirmed!' : 'Accepted! Navigation mode is activating...'}
                </span>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {isFacility && (
                  <Button
                    size="lg"
                    onClick={handleFacilityAccept}
                    disabled={actioning}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-[1rem] h-12 gap-2 font-semibold"
                  >
                    {actioning ? (
                      <Activity className="h-4 w-4 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                    Allocate from Inventory
                  </Button>
                )}
                {isUser && (
                  <Button
                    size="lg"
                    onClick={handleDonorAccept}
                    disabled={actioning}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-[1rem] h-12 gap-2 font-semibold"
                  >
                    {actioning ? (
                      <Activity className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Accept as Donor
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={handleDismiss}
                  className="rounded-[1rem] h-12 gap-2 border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-400/30"
                >
                  <XCircle className="h-4 w-4" />
                  Decline
                </Button>
              </div>
            )}

            {/* Multi-alert navigation */}
            {meshAlerts.length > 1 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  disabled={viewIndex === 0}
                  onClick={() => setViewIndex((v) => v - 1)}
                  className="text-xs text-slate-400 hover:text-white disabled:opacity-30 px-3 py-1.5 rounded-full border border-white/10"
                >
                  ← Previous
                </button>
                <span className="text-xs text-slate-500">
                  {meshAlerts.length - 1} more alert{meshAlerts.length > 2 ? 's' : ''}
                </span>
                <button
                  disabled={viewIndex >= meshAlerts.length - 1}
                  onClick={() => setViewIndex((v) => v + 1)}
                  className="text-xs text-slate-400 hover:text-white disabled:opacity-30 px-3 py-1.5 rounded-full border border-white/10"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Confirmation Toast ────────────────────────────────────────────────────────
// Appears in the bottom-right when REQUEST_CONFIRMED arrives at the requester.
// Reads ONLY from requestConfirmed.responderName — never touches user.name.
function ConfirmationToast({ confirmed }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Auto-dismiss after 8 seconds
    const t = setTimeout(() => {
      setVisible(false);
      clearRequestConfirmed();
    }, 8000);
    return () => clearTimeout(t);
  }, [confirmed]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[90] w-full max-w-sm animate-in slide-in-from-right-4 duration-300">
      <div className="rounded-[1.5rem] border border-emerald-400/30 bg-[linear-gradient(160deg,rgba(5,150,105,0.22),rgba(15,23,42,0.97))] backdrop-blur-xl p-5 shadow-[0_24px_60px_rgba(5,150,105,0.2)]">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            {/*
              receiverName = who accepted (new schema field)
              responderName = legacy alias
              NEVER use user.name here — this component reads only from the payload
            */}
            <p className="font-bold text-emerald-300 text-base leading-tight">
              Request Accepted by {confirmed.receiverName || confirmed.responderName}!
            </p>
            <p className="text-sm text-slate-400 mt-1">
              {confirmed.receiverType || confirmed.responderRole} is responding.
            </p>
            <p className="text-xs text-emerald-400/70 mt-2 font-medium">
              {confirmed.message}
            </p>
          </div>
          <button
            onClick={() => { setVisible(false); clearRequestConfirmed(); }}
            className="text-slate-500 hover:text-white transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
