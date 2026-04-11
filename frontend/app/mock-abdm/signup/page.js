'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import axios from 'axios';
import { Activity, ShieldCheck } from 'lucide-react';
import { API_URL } from '../../../lib/session';

export default function MockAbdmSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    aadhaar: '',
    email: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/api/auth/mock-abdm/signup`, form);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      sessionStorage.setItem('lifelink-gateway-session', JSON.stringify(res.data));
      sessionStorage.setItem('lifelink-generated-abha', JSON.stringify(res.data.credentials || null));
      router.push('/login?gateway_return=1');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#003366_0%,#0a2948_60%,#071a2d_100%)] flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-2xl rounded-[2rem] border border-white/15 bg-white/8 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-[#FF9933]" />
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#FF9933]">Internal Sandbox</p>
            <h1 className="mt-2 text-3xl font-semibold">Create Mock ABHA Identity</h1>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-200">
          Enter Aadhaar number, full name, and email. LifeLink will generate a 14-digit ABHA number and a PHR address in the internal sandbox registry.
        </p>
        {error && <div className="mt-4 rounded-[1rem] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
        <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
          <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Full Name" className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none" required />
          <input value={form.aadhaar} onChange={(e) => setForm((prev) => ({ ...prev, aadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) }))} placeholder="Aadhaar Number" className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none" required />
          <input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none" required />
          <button type="submit" className="w-full rounded-[1rem] bg-[#FF9933] px-4 py-3 font-semibold text-[#003366] hover:bg-[#ffad52]">
            {loading ? <span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 animate-spin" />Generating ABHA Credentials...</span> : 'Create ABHA & Return to LifeLink'}
          </button>
        </form>
      </div>
    </div>
  );
}
