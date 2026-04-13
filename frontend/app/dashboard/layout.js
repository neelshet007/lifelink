'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, BadgeCheck, Building2, LogOut, ShieldCheck, User } from 'lucide-react';
import Link from 'next/link';
import EmergencyActionDock from '../../components/EmergencyActionDock';
import LocationSyncProvider from '../../components/LocationSyncProvider';
import MeshAlertModal from '../../components/MeshAlertModal';
import { useDpi } from '../../components/providers/DpiProvider';
import { Badge } from '../../components/ui/badge';
import { disconnectRealtimeSocket } from '../../lib/realtime';
import { getSocketStoreState, resetSocketStore, socketStoreSubscribe } from '../../lib/socketStore';

function clientSubscribe() {
  return () => {};
}

function socketSubscribe(callback) {
  return socketStoreSubscribe(callback);
}

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const { clearSession } = useDpi();
  const isClient = useSyncExternalStore(clientSubscribe, () => true, () => false);
  const { connectionStatus } = useSyncExternalStore(socketSubscribe, getSocketStoreState, getSocketStoreState);
  // NOTE: user is read ONLY from localStorage here — it is the logged-in person.
  // Incoming mesh alert senderNames are stored separately in socketStore.meshAlerts.
  const token = isClient ? localStorage.getItem('token') : null;
  const user = isClient ? JSON.parse(localStorage.getItem('user') || 'null') : null;

  useEffect(() => {
    if (isClient && (!token || !user)) {
      router.push('/login');
    }
  }, [isClient, router, token, user]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('lifelink-active-emergency');
    disconnectRealtimeSocket();
    resetSocketStore();
    clearSession();
    router.push('/');
  };

  if (!isClient || !user) {
    return (
      <div className="min-h-screen bg-brand-dark flex justify-center items-center">
        <span className="flex h-4 w-4 rounded-full bg-lifered-500 animate-pulse"></span>
      </div>
    );
  }

  const identityIcon = user.identityType === 'ABHA' ? User : user.role === 'Hospital' ? Building2 : ShieldCheck;
  const IdentityIcon = identityIcon;
  const online = connectionStatus === 'online';
  const connectionLabel = online ? 'System Online' : connectionStatus === 'connecting' ? 'Connecting' : 'System Offline';

  return (
    <div className="min-h-screen bg-brand-dark text-white flex flex-col">
      <LocationSyncProvider />
      <nav className="glass border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link href="/" className="flex items-center gap-2">
              <Activity className="h-6 w-6 text-lifered-500" />
              <span className="font-bold text-xl tracking-tight hidden sm:block">
                Life<span className="text-lifered-500">Link</span>
              </span>
            </Link>

            <div className="flex items-center gap-4">
              <div className="hidden rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-slate-200 sm:inline-flex sm:items-center sm:gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : connectionStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`}></span>
                {connectionLabel}
              </div>
              <div className="text-sm border-r border-white/20 pr-4 text-right space-y-1">
                <p className="font-medium text-white">{user.name}</p>
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <p className="text-lifered-400 text-xs font-semibold">{user.role}</p>
                  {user.verificationBadge && (
                    <Badge variant={user.role === 'User' ? 'blue' : 'success'} className="hidden sm:inline-flex">
                      <BadgeCheck className="h-3.5 w-3.5" />
                      {user.verificationBadge}
                    </Badge>
                  )}
                </div>
                <p className="hidden sm:flex items-center justify-end gap-1 text-[11px] text-slate-400">
                  <IdentityIcon className="h-3 w-3 text-[#ff8f1f]" />
                  {user.abhaAddress || user.hfrFacilityId || user.dcgiLicenseNumber || user.identityType}
                </p>
              </div>
              <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 group">
                <LogOut className="h-5 w-5 group-hover:text-lifered-500 transition-colors" />
                <span className="text-sm hidden sm:block">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Persistent Mesh Alert Modal (all roles, all pages) ───────────────── */}
      {/* Rendered after the nav so it sits on top of all page content */}
      <MeshAlertModal />

      <main className="flex-1 w-full mx-auto relative relative pb-40">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full overflow-hidden z-0 pointer-events-none">
          <div className="absolute top-[10%] right-[10%] w-[300px] h-[300px] bg-[#0b4ea2]/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-[20%] left-[5%] w-[400px] h-[400px] bg-[#ff8f1f]/8 rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
      <EmergencyActionDock />
    </div>
  );
}
