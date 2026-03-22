'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, LogOut } from 'lucide-react';
import Link from 'next/link';

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (!token || !userData) {
      router.push('/login');
    } else {
      setUser(JSON.parse(userData));
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/');
  };

  if (!mounted || !user) {
    return (
      <div className="min-h-screen bg-brand-dark flex justify-center items-center">
        <span className="flex h-4 w-4 rounded-full bg-lifered-500 animate-pulse"></span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark text-white flex flex-col">
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
              <div className="text-sm border-r border-white/20 pr-4 text-right">
                <p className="font-medium text-white">{user.name}</p>
                <p className="text-lifered-400 text-xs font-semibold">{user.role}</p>
              </div>
              <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 group">
                <LogOut className="h-5 w-5 group-hover:text-lifered-500 transition-colors" />
                <span className="text-sm hidden sm:block">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>
      
      <main className="flex-1 w-full mx-auto relative relative">
        {/* Background blobs for dashboard */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full overflow-hidden z-0 pointer-events-none">
          <div className="absolute top-[10%] right-[10%] w-[300px] h-[300px] bg-lifered-600/5 rounded-full blur-[100px]" />
          <div className="absolute bottom-[20%] left-[5%] w-[400px] h-[400px] bg-lifered-400/5 rounded-full blur-[120px]" />
        </div>
        
        <div className="relative z-10 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
           {children}
        </div>
      </main>
    </div>
  );
}
