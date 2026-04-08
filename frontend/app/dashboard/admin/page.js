'use client';

import { useSyncExternalStore } from 'react';
import { ShieldAlert, Users, Activity, Droplet } from 'lucide-react';

function subscribe() {
  return () => {};
}

export default function AdminDashboard() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const user = isClient ? JSON.parse(localStorage.getItem('user') || 'null') : null;
  const stats = {
    totalUsers: 145,
    totalRequests: 89,
    fulfilled: 42
  };

  if (!user || user.role !== 'Admin') return null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-brand-gray/40 border border-white/5 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-lifered-500/5 rounded-full blur-[80px]" />

        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
             System Admin Center
          </h1>
          <p className="text-gray-400">View overall platform analytics and monitor users.</p>
        </div>
        <div className="p-3 bg-brand-dark rounded-xl border border-white/10 relative z-10 shadow-lg">
          <ShieldAlert className="h-6 w-6 text-lifered-500" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-lifered-500/30 transition-colors group">
           <div className="flex justify-between items-center mb-4">
             <div className="p-2 bg-lifered-500/10 rounded-lg group-hover:bg-lifered-500/20 transition-colors">
               <Users className="h-5 w-5 text-lifered-500" />
             </div>
             <span className="text-sm font-medium text-gray-400">Total Users</span>
           </div>
           <h2 className="text-4xl font-bold text-white">{stats.totalUsers}</h2>
        </div>

        <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-lifered-500/30 transition-colors group">
           <div className="flex justify-between items-center mb-4">
             <div className="p-2 bg-lifered-500/10 rounded-lg group-hover:bg-lifered-500/20 transition-colors">
               <Activity className="h-5 w-5 text-lifered-500" />
             </div>
             <span className="text-sm font-medium text-gray-400">Total Requests</span>
           </div>
           <h2 className="text-4xl font-bold text-white">{stats.totalRequests}</h2>
        </div>

        <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-green-500/30 transition-colors group">
           <div className="flex justify-between items-center mb-4">
             <div className="p-2 bg-green-500/10 rounded-lg group-hover:bg-green-500/20 transition-colors">
               <Droplet className="h-5 w-5 text-green-500" />
             </div>
             <span className="text-sm font-medium text-gray-400">Fulfilled</span>
           </div>
           <h2 className="text-4xl font-bold text-white">{stats.fulfilled}</h2>
        </div>
      </div>

      <div className="glass-dark border border-white/5 p-8 rounded-2xl text-center shadow-xl mt-8">
         <ShieldAlert className="h-12 w-12 text-gray-500 mx-auto mb-4 opacity-50" />
         <h3 className="text-lg font-medium text-gray-300">Admin Actions Restricted</h3>
         <p className="text-gray-500 mt-2 max-w-lg mx-auto">
           As per privacy policies, Admins can view analytics but cannot approve or reject blood requests. The matching engine handles routing autonomously.
         </p>
      </div>
    </div>
  );
}
