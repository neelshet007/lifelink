'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Activity, ArrowRight, Building2, ShieldCheck } from 'lucide-react';

export default function MockGovernmentGatewayClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      try {
        const identityType = searchParams.get('identityType');
        const identifier = searchParams.get('identifier');
        const returnTo = searchParams.get('returnTo') || '/login';
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const res = await axios.post('http://localhost:5000/api/auth/gateway-login/complete', {
          identityType,
          identifier,
          declarationAccepted: true,
        });
        sessionStorage.setItem('lifelink-gateway-session', JSON.stringify(res.data));
        setStatus('complete');
        await new Promise((resolve) => setTimeout(resolve, 900));
        router.push(`${returnTo}?gateway_return=1`);
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Government bridge failed');
        setStatus('error');
      }
    };

    run();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0b4ea2_0%,#12396c_58%,#0f172a_100%)] flex items-center justify-center p-4 text-white relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[10%] left-[10%] h-[320px] w-[320px] rounded-full bg-white/10 blur-[120px]" />
        <div className="absolute bottom-[8%] right-[12%] h-[260px] w-[260px] rounded-full bg-[#ff8f1f]/30 blur-[120px]" />
      </div>
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-2xl rounded-[2rem] border border-white/15 bg-white/10 p-8 backdrop-blur-xl shadow-[0_24px_100px_rgba(2,8,23,0.35)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-[#ffd19e]">Government Profile Initialization</p>
            <h1 className="mt-4 text-3xl font-semibold">National Health Authority Sandbox</h1>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <Building2 className="h-7 w-7 text-[#ffd19e]" />
          </div>
        </div>

        <div className="mt-10 flex items-center gap-6">
          <motion.div animate={{ rotate: status === 'error' ? 0 : 360 }} transition={{ repeat: status === 'error' ? 0 : Infinity, duration: 2, ease: 'linear' }} className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-white/40">
            {status === 'complete' ? <ShieldCheck className="h-8 w-8 text-[#86efac]" /> : <Activity className="h-8 w-8 text-white" />}
          </motion.div>
          <div>
            <h2 className="text-2xl font-semibold">{status === 'complete' ? 'Verified profile initialized' : 'Initializing verified profile via ABDM Sandbox'}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-100">
              {status === 'error' ? error : 'Fetching FHIR identity payload, registry attestations, and secure bridge claims before returning to LifeLink.'}
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {['Identity payload', 'FHIR resource map', 'Facility attestation'].map((item, index) => (
            <div key={item} className="rounded-[1.25rem] border border-white/15 bg-white/8 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/70">Step {index + 1}</p>
              <p className="mt-2 text-sm font-medium text-white">{item}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center justify-between rounded-[1.25rem] border border-white/15 bg-white/8 px-5 py-4 text-sm text-slate-100">
          <span>Returning to LifeLink with a verified session envelope</span>
          <ArrowRight className="h-4 w-4" />
        </div>
      </motion.div>
    </div>
  );
}
