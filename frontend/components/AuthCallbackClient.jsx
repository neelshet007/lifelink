'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { Activity, ShieldCheck } from 'lucide-react';

function decodeMockToken(token) {
  try {
    return JSON.parse(atob(token));
  } catch {
    return null;
  }
}

export default function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      try {
        const tokenFromUrl = searchParams.get('mockToken');
        const storedToken = localStorage.getItem('mock-abdm-transfer');
        const mockToken = tokenFromUrl || storedToken;
        const decoded = decodeMockToken(mockToken);
        if (!decoded) {
          throw new Error('Invalid mock gateway token');
        }

        localStorage.removeItem('mock-abdm-transfer');
        const sessionRes = await axios.post('http://localhost:5000/api/auth/gateway-login/complete', {
          identityType: decoded.identityType,
          identifier: decoded.identifier,
          declarationAccepted: true,
        });

        if (decoded.fhirBundle) {
          const patient = decoded.fhirBundle.entry?.find((entry) => entry.resource?.resourceType === 'Patient')?.resource;
          sessionRes.data.fhirPatient = patient || sessionRes.data.fhirPatient;
        }

        sessionStorage.setItem('lifelink-gateway-session', JSON.stringify(sessionRes.data));
        const returnTo = searchParams.get('returnTo') || '/login';
        router.push(`${returnTo}?gateway_return=1`);
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Authorization bridge failed');
      }
    };

    run();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#081b31_0%,#0f172a_100%)] flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/15 bg-white/8 p-8 text-center backdrop-blur-xl">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/10">
          {error ? <ShieldCheck className="h-12 w-12 text-red-300" /> : <Activity className="h-12 w-12 animate-spin text-[#FF9933]" />}
        </div>
        <h1 className="text-3xl font-semibold">Completing LifeLink authorization</h1>
        <p className="mt-4 text-sm leading-6 text-slate-200">{error || 'Verifying the mock token, reconciling MongoDB, and preparing your verified session.'}</p>
      </div>
    </div>
  );
}
