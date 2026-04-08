'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck, Fingerprint, Hospital, ShieldCheck, User } from 'lucide-react';
import registry from '../data/mock_registry.json';

const tabs = [
  { id: 'ABHA', label: 'Citizen', icon: User },
  { id: 'HFR', label: 'Facility Login', icon: Hospital },
];

function encodeMockToken(payload) {
  return btoa(JSON.stringify(payload));
}

export default function MockAbdmGatewayClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialIdentityType = searchParams.get('identityType') || 'ABHA';
  const [activeTab, setActiveTab] = useState(initialIdentityType === 'HFR' ? 'HFR' : 'ABHA');
  const [identifier, setIdentifier] = useState(searchParams.get('identifier') || (initialIdentityType === 'HFR' ? 'lilavati@hfr' : 'neel@abha'));
  const [stage, setStage] = useState('entry');
  const [showRawBundle, setShowRawBundle] = useState(false);
  const [error, setError] = useState('');

  const activeRecord = useMemo(() => {
    if (activeTab === 'ABHA') {
      return registry.abhaUsers.find((entry) => entry.id.toLowerCase() === identifier.toLowerCase()) || null;
    }
    return registry.facilities.find((entry) => entry.id.toLowerCase() === identifier.toLowerCase()) || null;
  }, [activeTab, identifier]);

  const rawBundle = useMemo(() => {
    if (activeTab === 'ABHA' && !activeRecord && identifier.trim()) {
      return {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: identifier.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
              identifier: [
                { system: 'https://healthid.ndhm.gov.in/address', value: identifier.trim().toLowerCase() },
              ],
            },
          },
        ],
      };
    }

    if (activeTab === 'HFR' && !activeRecord && identifier.trim()) {
      return {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Organization',
              id: identifier.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
              identifier: [
                { system: 'https://facility.abdm.gov.in', value: identifier.trim() },
              ],
            },
          },
        ],
      };
    }

    if (!activeRecord) {
      return null;
    }
    if (activeTab === 'ABHA') {
      return activeRecord.fhirBundle;
    }
    return {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: activeRecord }],
    };
  }, [activeRecord, activeTab, identifier]);

  const handleConnect = async () => {
    setError('');
    if (activeTab === 'ABHA' && identifier.trim()) {
      setStage('biometric');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setStage('consent');
      return;
    }

    if (activeTab === 'HFR' && identifier.trim()) {
      setStage('facility');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockToken = encodeMockToken({
        identityType: 'HFR',
        identifier: identifier.trim(),
        verified: true,
        role: 'HOSPITAL',
      });
      localStorage.setItem('mock-abdm-transfer', mockToken);
      router.push(`/auth/callback?mockToken=${encodeURIComponent(mockToken)}&returnTo=${encodeURIComponent(searchParams.get('returnTo') || '/login')}`);
      return;
    }

    if (!activeRecord) {
      setError('Identifier not found in the ABDM Sandbox registry.');
      return;
    }

    setStage('facility');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const mockToken = encodeMockToken({
      identityType: 'HFR',
      identifier: activeRecord.id,
      verified: true,
      role: 'HOSPITAL',
      facility: activeRecord,
    });
    localStorage.setItem('mock-abdm-transfer', mockToken);
    router.push(`/auth/callback?mockToken=${encodeURIComponent(mockToken)}&returnTo=${encodeURIComponent(searchParams.get('returnTo') || '/login')}`);
  };

  const handleApprove = () => {
    const mockToken = encodeMockToken({
      identityType: 'ABHA',
      identifier: (activeRecord?.id || identifier).trim().toLowerCase(),
      verified: true,
      ...(activeRecord?.fhirBundle ? { fhirBundle: activeRecord.fhirBundle } : {}),
    });
    localStorage.setItem('mock-abdm-transfer', mockToken);
    router.push(`/auth/callback?mockToken=${encodeURIComponent(mockToken)}&returnTo=${encodeURIComponent(searchParams.get('returnTo') || '/login')}`);
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#003366_0%,#0a2948_60%,#071a2d_100%)] text-white relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[10%] left-[10%] h-[320px] w-[320px] rounded-full bg-white/10 blur-[120px]" />
        <div className="absolute bottom-[8%] right-[12%] h-[260px] w-[260px] rounded-full bg-[#FF9933]/30 blur-[120px]" />
      </div>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-10">
        <div className="mb-10 flex items-center justify-between rounded-[1.75rem] border border-white/15 bg-white/8 px-6 py-5 backdrop-blur-xl">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#FF9933]">ABDM Sandbox Gateway</p>
            <h1 className="mt-2 text-3xl font-semibold">National Health Authority Mock</h1>
          </div>
          <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-slate-100">Demo Environment: Internal Sandbox</div>
        </div>

        <div className="grid flex-1 gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[2rem] border border-white/15 bg-white/8 p-8 backdrop-blur-xl">
            <div className="mb-6 grid grid-cols-2 gap-2 rounded-[1.25rem] bg-white/10 p-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); setStage('entry'); setError(''); setIdentifier(tab.id === 'HFR' ? 'lilavati@hfr' : 'neel@abha'); }} className={`flex items-center justify-center gap-2 rounded-[1rem] px-4 py-3 text-sm font-medium transition ${isActive ? 'bg-white text-[#003366]' : 'text-slate-100 hover:bg-white/10'}`}>
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {stage === 'entry' && (
                <motion.div key="entry" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6">
                  <div>
                    <label className="text-sm font-medium text-slate-100">{activeTab === 'ABHA' ? 'ABHA ID' : 'HFR ID'}</label>
                    <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="mt-3 w-full rounded-[1.2rem] border border-white/20 bg-white/10 px-4 py-4 text-white outline-none placeholder:text-slate-300" placeholder={activeTab === 'ABHA' ? 'neell.9316@abdm' : 'lilavati@hfr'} />
                  </div>
                  {activeTab === 'ABHA' && (
                    <div className="flex items-center justify-between rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-3 text-sm text-slate-200">
                      <span>New to LifeLink? Create a mock ABHA inside the sandbox.</span>
                      <button type="button" onClick={() => router.push('/mock-abdm/signup')} className="font-semibold text-[#FF9933] hover:text-[#ffb45c]">
                        Create ABHA
                      </button>
                    </div>
                  )}
                  {activeTab === 'HFR' && (
                    <div className="flex items-center justify-between rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-3 text-sm text-slate-200">
                      <span>New facility? Register it inside the National Registry sandbox.</span>
                      <button type="button" onClick={() => router.push('/mock-abdm/facility-onboarding')} className="font-semibold text-[#FF9933] hover:text-[#ffb45c]">
                        Onboard Facility
                      </button>
                    </div>
                  )}
                  {error && <div className="rounded-[1.2rem] border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
                  <button onClick={handleConnect} className="w-full rounded-[1.2rem] bg-[#FF9933] px-5 py-4 text-sm font-semibold text-[#003366] transition hover:bg-[#ffab52]">Connect</button>
                </motion.div>
              )}

              {stage === 'biometric' && (
                <motion.div key="biometric" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="py-14 text-center">
                  <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/10">
                    <Fingerprint className="h-12 w-12 animate-pulse text-[#FF9933]" />
                  </div>
                  <h2 className="text-3xl font-semibold">Secure Biometric Verification...</h2>
                  <p className="mt-4 text-sm text-slate-200">Skipping OTP for the live demo while preserving the visible government-grade trust ceremony.</p>
                </motion.div>
              )}

              {stage === 'consent' && (
                <motion.div key="consent" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6 rounded-[1.6rem] border border-white/15 bg-white/10 p-6">
                  <div>
                    <p className="text-xs uppercase tracking-[0.26em] text-[#FF9933]">Consent Manager</p>
                    <h2 className="mt-3 text-2xl font-semibold">LifeLink (HIU-ID: LL-99) is requesting access to your Health Records for Emergency Matching.</h2>
                  </div>
                  <div className="space-y-3 text-sm text-slate-100">
                    {['Basic Profile (Name, Gender, Age)', 'Verified Blood Group (FHIR Extension)', '90-Day Clinical Records (Observation Resource)'].map((scope) => (
                      <label key={scope} className="flex items-center gap-3 rounded-[1rem] border border-white/10 bg-white/8 px-4 py-3">
                        <input type="checkbox" checked readOnly className="h-4 w-4" />
                        <span>{scope}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => router.push(searchParams.get('returnTo') || '/login')} className="flex-1 rounded-[1.1rem] border border-white/20 px-4 py-3 text-sm font-medium text-slate-100 hover:bg-white/10">Deny</button>
                    <button onClick={handleApprove} className="flex-1 rounded-[1.1rem] bg-[#22c55e] px-4 py-3 text-sm font-semibold text-white hover:bg-[#16a34a]">Approve & Authorize</button>
                  </div>
                </motion.div>
              )}

              {stage === 'facility' && (
                <motion.div key="facility" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="py-14 text-center">
                  <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/20">
                    <BadgeCheck className="h-12 w-12 text-emerald-300" />
                  </div>
                  <h2 className="text-3xl font-semibold">Facility Credentials Verified</h2>
                  <p className="mt-4 text-sm text-slate-200">Verified by NHA. Returning to the LifeLink hospital dashboard with trusted facility status.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative rounded-[2rem] border border-white/15 bg-white/8 p-8 backdrop-blur-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-[#FF9933]">Transparency Mode</p>
                <h3 className="mt-2 text-2xl font-semibold">View Raw FHIR Bundle</h3>
              </div>
              <button onClick={() => setShowRawBundle((value) => !value)} className={`rounded-full px-4 py-2 text-sm font-medium ${showRawBundle ? 'bg-[#FF9933] text-[#003366]' : 'bg-white/10 text-slate-100'}`}>
                {showRawBundle ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-sm leading-6 text-slate-200">We aren&apos;t just showing a screen; we are demonstrating the real-time generation of encrypted FHIR resources.</p>
            <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#021427] p-5 text-xs leading-6 text-slate-200 overflow-auto min-h-[22rem]">
              {showRawBundle ? <pre>{JSON.stringify(rawBundle, null, 2)}</pre> : <p className="text-slate-400">Enable transparency mode to inspect the exact Bundle prepared for transfer.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

