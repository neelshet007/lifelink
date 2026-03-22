'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity, Menu, X } from 'lucide-react';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed w-full z-50 glass border-b border-white/10 top-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          <div className="flex-shrink-0 flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="p-2 bg-lifered-500/10 rounded-xl border border-lifered-500/20">
                <Activity className="h-6 w-6 text-lifered-500" />
              </div>
              <span className="font-bold text-2xl tracking-tight text-white">
                Life<span className="text-lifered-500">Link</span>
              </span>
            </Link>
          </div>
          
          <div className="hidden md:flex space-x-8 items-center">
            <Link href="/#features" className="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium">Features</Link>
            
            <div className="flex items-center gap-4 pl-4 border-l border-white/10">
              <Link href="/login" className="text-sm font-medium px-4 py-2 rounded-xl text-white hover:bg-white/5 transition-colors duration-200">
                Sign In
              </Link>
              <Link href="/register" className="text-sm font-medium px-5 py-2.5 rounded-xl bg-lifered-600 hover:bg-lifered-500 text-white transition-all shadow-lg shadow-lifered-500/20 active:scale-95 border border-lifered-400/20">
                Get Started
              </Link>
            </div>
          </div>
          
          <div className="md:hidden flex items-center">
            <button onClick={() => setIsOpen(!isOpen)} className="text-gray-300 hover:text-white p-2">
              {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>
      
      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden glass-dark border-b border-white/10 absolute w-full left-0 top-20">
          <div className="px-4 pt-2 pb-6 space-y-4 flex flex-col">
            <Link href="/#features" className="text-gray-300 hover:text-white block px-3 py-2 text-base font-medium">Features</Link>
            <div className="pt-4 border-t border-white/10 flex flex-col gap-3">
              <Link href="/login" className="text-center text-sm font-medium px-4 py-3 rounded-xl border border-white/10 text-white hover:bg-white/5">
                Sign In
              </Link>
              <Link href="/register" className="text-center text-sm font-medium px-4 py-3 rounded-xl bg-lifered-600 hover:bg-lifered-500 text-white">
                Get Started
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
