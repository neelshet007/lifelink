'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import axios from 'axios';
import { Activity, Building2, ShieldCheck } from 'lucide-react';

export default function FacilityOnboardingPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    facilityName: '',
    category: 'Hospital',
    governmentRegNo: '',
    administratorAadhaar: '',
    email: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await axios.post('http://localhost:5000/api/auth/mock-abdm/facility-onboarding', form);
      setCredentials(res.data.credentials);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      sessionStorage.setItem('lifelink-gateway-session', JSON.stringify(res.data));
      setTimeout(() => {
        router.push('/login?gateway_return=1');
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Facility onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#003366_0%,#0a2948_60%,#071a2d_100%)] flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-3xl rounded-[2rem] border border-white/15 bg-white/8 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Building2 className="h-8 w-8 text-[#FF9933]" />
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#FF9933]">National Registry Sandbox</p>
            <h1 className="mt-2 text-3xl font-semibold">Facility Onboarding</h1>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-200">Register a Hospital or Blood Bank into the mock ABDM ecosystem. We will generate a government-style facility ID, an HFR ID, and a DCGI code for blood banks.</p>
        {error && <div className="mt-4 rounded-[1rem] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
        {credentials && (
          <div className="mt-4 rounded-[1rem] border border-emerald-300/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-50">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />Facility verified in the sandbox registry</div>
            <p className="mt-2">ABDM Facility ID: {credentials.facilityAbdmId}</p>
            <p className="mt-1">HFR ID: {credentials.hfrFacilityId}</p>
            {credentials.dcgiLicenseNumber && <p className="mt-1">DCGI License: {credentials.dcgiLicenseNumber}</p>}
          </div>
        )}
        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-2">
          <input value={form.facilityName} onChange={(e) => setForm((prev) => ({ ...prev, facilityName: e.target.value }))} placeholder="Facility Name" className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none md:col-span-2" required />
          <select value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none">
            {['Hospital', 'Blood Bank'].map((category) => <option key={category} value={category} className="bg-slate-900">{category}</option>)}
          </select>
          <input value={form.governmentRegNo} onChange={(e) => setForm((prev) => ({ ...prev, governmentRegNo: e.target.value }))} placeholder="Government Reg No / Certificate No" className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none" required />
          <input value={form.administratorAadhaar} onChange={(e) => setForm((prev) => ({ ...prev, administratorAadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) }))} placeholder="Administrator Aadhaar" className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none" required />
          <input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Administrator Email" className="w-full rounded-[1rem] border border-white/15 bg-white/10 px-4 py-3 text-white outline-none" required />
          <button type="submit" className="w-full rounded-[1rem] bg-[#FF9933] px-4 py-3 font-semibold text-[#003366] hover:bg-[#ffad52] md:col-span-2">
            {loading ? <span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 animate-spin" />Verifying and issuing registry IDs...</span> : 'Register Facility'}
          </button>
        </form>
      </div>
    </div>
  );
}
