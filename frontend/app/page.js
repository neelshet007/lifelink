// Landing page with modern startup aesthetic
import Navbar from '../components/Navbar';
import { ArrowRight, Activity, MapPin, Zap, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-brand-dark overflow-hidden">
      <Navbar />
      
      {/* Hero Section */}
      <div className="relative pt-32 pb-20 sm:pt-40 sm:pb-24">
        {/* Abstract background blobs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full overflow-hidden z-0 pointer-events-none">
          <div className="absolute top-[20%] left-[20%] w-[500px] h-[500px] bg-lifered-600/20 rounded-full blur-[120px]" />
          <div className="absolute top-[40%] right-[10%] w-[400px] h-[400px] bg-lifered-400/10 rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative text-center z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-lifered-500/30 mb-8">
            <span className="flex h-2 w-2 rounded-full bg-lifered-500 animate-pulse"></span>
            <span className="text-sm font-medium text-lifered-100">Smart Matching Engine v1.0 Live</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tight mb-8">
            Save Lives Faster with <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-lifered-400 to-lifered-600">
              Smart Blood Matching
            </span>
          </h1>
          
          <p className="mt-4 max-w-2xl text-xl text-gray-400 mx-auto mb-10">
            LifeLink connects blood donors, patients, hospitals, and blood banks in real-time, matching needs within seconds using geospatial analysis.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" className="inline-flex justify-center items-center px-8 py-4 text-base font-semibold text-white bg-lifered-600 rounded-xl hover:bg-lifered-500 transition-all shadow-xl shadow-lifered-600/20 active:scale-95">
              Request Blood Now
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
            <Link href="/register?role=Donor" className="inline-flex justify-center items-center px-8 py-4 text-base font-semibold text-white glass-card rounded-xl hover:bg-white/10 transition-all active:scale-95">
              Become a Donor
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="border-y border-white/5 bg-brand-gray/30 py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4 text-center">
            {[
              { label: 'Faster Response', value: '30-50%' },
              { label: 'Target Radius', value: '10-20km' },
              { label: 'Role Types', value: '4' },
              { label: 'Match Algorithm', value: 'Haversine' }
            ].map((stat, i) => (
              <div key={i} className="flex flex-col gap-1">
                <span className="text-4xl font-bold tracking-tight text-white">{stat.value}</span>
                <span className="text-sm font-medium text-gray-400">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div id="features" className="py-24 sm:py-32 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl mb-4">
              Not just a directory. A smart engine.
            </h2>
            <p className="text-lg text-gray-400">
              Traditional blood banks rely on phone calls and static directories. We use geospatial algorithms to match patients with the perfect donor instantly.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: <Zap className="h-6 w-6 text-lifered-500" />,
                title: 'Real-time Alerts',
                description: 'Instant Socket.io notifications pushed to nearby eligible donors when an urgent request is generated.'
              },
              {
                icon: <MapPin className="h-6 w-6 text-lifered-500" />,
                title: 'Geospatial Matching',
                description: 'Calculates precise distance between patients and donors to ensure the fastest possible delivery of life-saving blood.'
              },
              {
                icon: <ShieldCheck className="h-6 w-6 text-lifered-500" />,
                title: 'Trusted Authorities',
                description: 'Hospitals and recognized Blood Banks have verified accounts to manage inventory and validate fulfillment requests.'
              }
            ].map((feature, idx) => (
              <div key={idx} className="glass-card p-8 rounded-2xl border border-white/5 hover:border-lifered-500/30 transition-colors group">
                <div className="p-3 bg-brand-dark rounded-xl inline-block mb-4 border border-white/5 group-hover:bg-lifered-500/10 transition-colors">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="border-t border-white/10 bg-brand-dark py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-6 w-6 text-lifered-500" />
              <span className="font-bold text-xl tracking-tight text-white">
                Life<span className="text-lifered-500">Link</span>
              </span>
            </div>
            <p className="text-gray-500 text-sm">© 2026 LifeLink platform. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
