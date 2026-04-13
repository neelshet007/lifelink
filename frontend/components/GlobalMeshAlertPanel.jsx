'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Activity, Building2, CheckCircle2, Hospital, Package, Siren, User, XCircle } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { getRealtimeSocket } from '../lib/realtime';
import { getStoredUser } from '../lib/session';
import { getSocketStoreState, removeMeshAlert, socketStoreSubscribe } from '../lib/socketStore';

function subscribe(callback) {
  return socketStoreSubscribe(callback);
}

const URGENCY_STYLES = {
  Critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  Immediate: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  Standard: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const ROLE_ICON = {
  Hospital: Hospital,
  'Blood Bank': Building2,
  User: User,
};

export default function GlobalMeshAlertPanel({ compact = false }) {
  const { meshAlerts, requestConfirmed } = useSyncExternalStore(subscribe, getSocketStoreState, getSocketStoreState);
  const user = useMemo(() => getStoredUser(), []);
  const [actioning, setActioning] = useState(null); // requestId being actioned

  const handleFacilityAccept = (alert) => {
    setActioning(alert.requestId);
    const socket = getRealtimeSocket();
    socket.emit('FACILITY_ACCEPTED_REQUEST', {
      requestId: alert.requestId,
      bloodGroup: alert.bloodGroup,
      bloodUnits: alert.bloodUnits,
    });
    removeMeshAlert(alert.requestId);
    setActioning(null);
  };

  const handleDonorAccept = (alert) => {
    setActioning(alert.requestId);
    const socket = getRealtimeSocket();
    const userId = user?._id || user?.id;
    socket.emit('DONOR_ACCEPTED_REQUEST', {
      requestId: alert.requestId,
      donorId: userId,
    });
    // Legacy path also
    socket.emit('DONOR_ACCEPTED', { requestId: alert.requestId, donorId: userId });
    removeMeshAlert(alert.requestId);
    setActioning(null);
  };

  const handleDismiss = (alert) => {
    const socket = getRealtimeSocket();
    const userId = user?._id || user?.id;
    socket.emit('DONOR_DECLINED', { requestId: alert.requestId, donorId: userId });
    removeMeshAlert(alert.requestId);
  };

  if (!meshAlerts || meshAlerts.length === 0) {
    if (compact) return null;
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-500">
        <Activity className="h-10 w-10 opacity-20 mb-3" />
        <p className="text-sm">No active mesh alerts in your radius.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* REQUEST_CONFIRMED banner */}
      {requestConfirmed && (
        <div className="rounded-[1.2rem] border border-emerald-400/30 bg-emerald-500/10 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-300">{requestConfirmed.message}</p>
            <p className="text-xs text-slate-400 mt-0.5">Responder: {requestConfirmed.responderName} · {requestConfirmed.responderRole}</p>
          </div>
        </div>
      )}

      {meshAlerts.map((alert) => {
        const urgencyStyle = URGENCY_STYLES[alert.urgency] || URGENCY_STYLES.Standard;
        const SenderIcon = ROLE_ICON[alert.senderType] || Siren;
        const isFacility = user?.role === 'Hospital' || user?.role === 'Blood Bank';
        const isUser = user?.role === 'User';
        const isActioning = actioning === alert.requestId;

        return (
          <div
            key={alert.requestId}
            className="flex flex-col sm:flex-row sm:items-center justify-between rounded-[1.2rem] border border-white/10 bg-white/5 p-5 hover:bg-white/8 transition-colors gap-4"
          >
            {/* Left: info */}
            <div className="flex items-center gap-4">
              <div className={`h-14 w-14 rounded-full flex items-center justify-center text-lg font-bold border ${urgencyStyle}`}>
                {alert.bloodGroup}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <SenderIcon className="h-4 w-4 text-slate-400" />
                  <span className="font-semibold text-white">{alert.hospital || alert.senderName}</span>
                  <Badge variant={alert.urgency === 'Critical' ? 'saffron' : 'subtle'}>{alert.urgency}</Badge>
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  {alert.senderType} · {alert.distanceKm ?? alert.distance ?? '?'} km · {alert.bloodUnits || 1} unit(s)
                </p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{alert.message}</p>
              </div>
            </div>

            {/* Right: action buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {isFacility && (
                <Button
                  size="sm"
                  onClick={() => handleFacilityAccept(alert)}
                  disabled={isActioning}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-[0.8rem] gap-2"
                >
                  {isActioning ? <Activity className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                  ALLOCATE STOCK
                </Button>
              )}
              {isUser && (
                <Button
                  size="sm"
                  onClick={() => handleDonorAccept(alert)}
                  disabled={isActioning}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-[0.8rem] gap-2"
                >
                  {isActioning ? <Activity className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  ACCEPT AS DONOR
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDismiss(alert)}
                className="rounded-[0.8rem] text-slate-400 hover:text-red-400"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
