'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, BadgeCheck, Building2, Hospital, MapPin, ShieldCheck, User } from 'lucide-react';
import { useDpi } from './providers/DpiProvider';
import { Button } from './ui/button';

const gatewayTabs = [
  {
    id: 'ABHA',
    label: 'Citizen',
    title: 'Connect via ABHA',
    placeholder: 'Enter your ABHA address, e.g. neel@abha',
    helper: 'ABHA-linked citizens connect through the dedicated mock ABDM Sandbox for a fast demo flow.',
    icon: User,
    accent: 'text-[#0b4ea2]',
    sample: 'neel@abha or malaria@abha',
  },
  {
    id: 'HFR',
    label: 'Hospital',
    title: 'Facility (HFR)',
    placeholder: 'Enter your HFR ID, e.g. lilavati@hfr',
    helper: 'HFR facilities route through the same government-style gateway and return with a verified badge.',
    icon: Hospital,
    accent: 'text-[#ff8f1f]',
    sample: 'lilavati@hfr',
  },
  {
    id: 'DCGI',
    label: 'Blood Bank',
    title: 'Blood Bank',
    placeholder: 'Enter DCGI License Number or HFR ID',
    helper: 'Blood banks still use the direct facility bridge and keep DCGI gating inside LifeLink.',
    icon: ShieldCheck,
    accent: 'text-[#0b4ea2]',
    sample: 'DCGI-BB-2026-014 or BB-HFR-112',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getRolePath(role) {
  return role.toLowerCase().replace(/\s+/g, '-');
}

export default function AuthForm() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { connectAbha, clearSession } = useDpi();
  const [activeTab, setActiveTab] = useState('ABHA');
  const [gatewayIdentifiers, setGatewayIdentifiers] = useState({
    ABHA: 'neel@abha',
    HFR: 'lilavati@hfr',
    DCGI: 'DCGI-BB-2026-014',
  });
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [transitionCopy, setTransitionCopy] = useState('');
  const [pendingSession, setPendingSession] = useState(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [locationError, setLocationError] = useState('');

  useEffect(() => {
    if (searchParams.get('gateway_return') !== '1') {
      return;
    }

    const stored = sessionStorage.getItem('lifelink-gateway-session');
    if (!stored) {
      return;
    }

    const parsed = JSON.parse(stored);
    sessionStorage.removeItem('lifelink-gateway-session');
    setPendingSession(parsed);
    setOnboardingStep(0);
    router.replace(pathname);
  }, [pathname, router, searchParams]);

  const activeTabConfig = useMemo(() => gatewayTabs.find((tab) => tab.id === activeTab), [activeTab]);

  const persistSession = (sessionData) => {
    clearSession();
    localStorage.setItem('token', sessionData.token);
    localStorage.setItem('user', JSON.stringify(sessionData.user));
    if (sessionData.user.identityType === 'ABHA' && sessionData.fhirPatient) {
      connectAbha(sessionData.fhirPatient);
    }
    router.push(`/dashboard/${getRolePath(sessionData.user.role)}`);
  };

  const requestBrowserLocation = () => new Promise((resolve) => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not available in this browser. Continuing without coordinates.');
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationError('');
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setLocationError('Location access was blocked. You can continue, but live emergency matching will be less precise.');
        resolve(null);
      }
    );
  });

  const runGatewayJourney = async () => {
    const identifier = gatewayIdentifiers[activeTab].trim();
    if (!identifier) {
      throw new Error('A verified identity value is required before connecting.');
    }
    if (!declarationAccepted) {
      throw new Error('Please accept the ABDM Sandbox declaration to continue.');
    }

    if (activeTab === 'ABHA' || activeTab === 'HFR') {
      router.push(`/mock-abdm?identityType=${activeTab}&identifier=${encodeURIComponent(identifier)}&returnTo=${encodeURIComponent(pathname)}`);
      return;
    }

    const completeRes = await axios.post('http://localhost:5000/api/auth/gateway-login/complete', {
      identityType: activeTab,
      identifier,
      declarationAccepted,
    });
    setTransitionCopy('Performing 90-day sync with the National Health Gateway...');
    await sleep(1500);
    setPendingSession(completeRes.data);
    setOnboardingStep(0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await runGatewayJourney();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const onboardingSteps = useMemo(() => {
    if (!pendingSession) {
      return [];
    }
    const isCitizen = pendingSession.user.role === 'User';
    const steps = ['location'];
    if (isCitizen) {
      steps.push('triage', 'consent');
    } else {
      steps.push('facility');
    }
    return steps;
  }, [pendingSession]);

  const currentOnboardingStep = onboardingSteps[onboardingStep];

  const handleOnboardingNext = async (action = 'continue') => {
    if (!pendingSession) {
      return;
    }

    const nextSession = { ...pendingSession, user: { ...pendingSession.user } };

    if (currentOnboardingStep === 'location' && action === 'allow') {
      const coords = await requestBrowserLocation();
      if (coords) {
        nextSession.user.location = { type: 'Point', coordinates: [coords.longitude, coords.latitude] };
      }
    }

    if (currentOnboardingStep === 'consent') {
      nextSession.user.nhcxConsent = action === 'allow';
    }

    if (onboardingStep >= onboardingSteps.length - 1) {
      setPendingSession(null);
      persistSession(nextSession);
      return;
    }

    setPendingSession(nextSession);
    setOnboardingStep((step) => step + 1);
  };

  return (
    <>
      <div className="w-full max-w-5xl rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.08)]">
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="p-8 sm:p-10">
            <div className="mb-8 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ff8f1f]">National Health Gateway</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-900">Zero-account verified entry for LifeLink</h2>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sandbox</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">ABDM + NHCX</p>
              </div>
            </div>

            <div className="mb-6 grid grid-cols-3 gap-2 rounded-[1.25rem] bg-slate-100 p-1">
              {gatewayTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex items-center justify-center gap-2 rounded-[1rem] px-3 py-3 text-sm font-medium transition ${isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
                    <Icon className={`h-4 w-4 ${isActive ? tab.accent : 'text-slate-400'}`} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {error && <div className="mb-5 rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-800">{activeTabConfig.title}</label>
                <div className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                  <input type="text" value={gatewayIdentifiers[activeTab]} onChange={(e) => setGatewayIdentifiers((prev) => ({ ...prev, [activeTab]: e.target.value }))} placeholder={activeTabConfig.placeholder} className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" />
                </div>
                <p className="text-xs text-slate-500">Sample: {activeTabConfig.sample}</p>
              </div>

              <label className="flex items-start gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
                <input type="checkbox" checked={declarationAccepted} onChange={(e) => setDeclarationAccepted(e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0b4ea2] focus:ring-[#0b4ea2]" />
                <span className="text-sm leading-6 text-slate-700">I authorize LifeLink to fetch my verified blood group and 90-day clinical history via the ABDM Sandbox for emergency eligibility.</span>
              </label>

              <Button type="submit" size="lg" className="w-full rounded-[1.25rem] bg-[#0b4ea2] hover:bg-[#083c7d]">
                {loading ? 'Connecting to National Health Gateway...' : 'Connect'}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </form>

            {activeTab === 'ABHA' && (
              <div className="mt-6 flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <p>New to LifeLink?</p>
                <button type="button" onClick={() => router.push('/mock-abdm/signup')} className="text-left font-medium text-[#0b4ea2] hover:text-[#083c7d]">
                  Create ABHA in the internal sandbox
                </button>
              </div>
            )}
            {(activeTab === 'HFR' || activeTab === 'DCGI') && (
              <div className="mt-6 flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <p>New facility?</p>
                <button type="button" onClick={() => router.push('/mock-abdm/facility-onboarding')} className="text-left font-medium text-[#0b4ea2] hover:text-[#083c7d]">
                  Register in the internal national registry
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#fff7ed_100%)] p-8 lg:border-l lg:border-t-0">
            <div className="rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trust Triangle</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">Triple-verified emergency exchange</h3>
                </div>
                <div className="rounded-2xl bg-[#0b4ea2]/10 p-3">
                  <Building2 className="h-6 w-6 text-[#0b4ea2]" />
                </div>
              </div>
              <div className="space-y-3 text-sm text-slate-700">
                <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">Verified Citizen</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">ABHA identity and FHIR health records are fetched on consent and not stored permanently.</p>
                </div>
                <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">Verified Hospital</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">HFR facilities receive location-aware, proof-backed donor signals during Red Alerts.</p>
                </div>
                <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">Verified Blood Bank</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Issue workflows unlock only after DCGI verification is confirmed.</p>
                </div>
              </div>
              <div className="mt-6 rounded-[1.2rem] border border-[#ff8f1f]/30 bg-[#fff7ed] p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Current lane</p>
                <p className="mt-1">{activeTabConfig.helper}</p>
              </div>
              {transitionCopy && <p className="mt-4 text-xs text-slate-500">{transitionCopy}</p>}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {pendingSession && currentOnboardingStep && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} className="w-full max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_100px_rgba(15,23,42,0.18)]">
              {currentOnboardingStep === 'location' && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ff8f1f]">Location Pulse</p>
                  <h3 className="mt-4 text-3xl font-semibold text-slate-900">Identity Verified. To enable Real-Time Emergency Matching, please allow Location Access.</h3>
                  <p className="mt-4 text-sm leading-6 text-slate-600">LifeLink uses live coordinates to prioritize nearby Red Alerts and shorten hospital response times.</p>
                  {locationError && <p className="mt-4 text-sm text-amber-700">{locationError}</p>}
                  <div className="mt-8 flex gap-3">
                    <Button variant="secondary" size="lg" className="flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={() => handleOnboardingNext('skip')}>Continue Without Location</Button>
                    <Button size="lg" className="flex-1 rounded-[1.25rem] bg-[#0b4ea2] hover:bg-[#083c7d]" onClick={() => handleOnboardingNext('allow')}>
                      <MapPin className="h-4 w-4" />
                      Allow Location Access
                    </Button>
                  </div>
                </div>
              )}
              {currentOnboardingStep === 'triage' && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ff8f1f]">Donor vs Patient Triage</p>
                  <h3 className="mt-4 text-3xl font-semibold text-slate-900">{pendingSession.user.bloodGroup ? 'Verified blood group detected. Donor-ready status activated.' : 'Profile Incomplete. Blood Group verification required to activate Donor Status.'}</h3>
                  <p className="mt-4 text-sm leading-6 text-slate-600">{pendingSession.user.bloodGroup ? `Your verified blood group is ${pendingSession.user.bloodGroup}. Donor-side emergency actions are now available.` : 'You can still access patient-side request workflows, but donor actions stay locked until the ABDM record is updated.'}</p>
                  <div className="mt-8 flex justify-end"><Button size="lg" className="rounded-[1.25rem] bg-[#0b4ea2] hover:bg-[#083c7d]" onClick={() => handleOnboardingNext('continue')}>Continue</Button></div>
                </div>
              )}
              {currentOnboardingStep === 'consent' && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ff8f1f]">NHCX Consent</p>
                  <h3 className="mt-4 text-3xl font-semibold text-slate-900">Allow LifeLink to share your verified blood group with nearby HFR-verified hospitals during a Red Alert?</h3>
                  <p className="mt-4 text-sm leading-6 text-slate-600">Only your verified blood group is shared for emergency triage. Identity and underlying records remain protected.</p>
                  <div className="mt-8 flex gap-3">
                    <Button variant="secondary" size="lg" className="flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={() => handleOnboardingNext('deny')}>Not Now</Button>
                    <Button size="lg" className="flex-1 rounded-[1.25rem] bg-[#0b4ea2] hover:bg-[#083c7d]" onClick={() => handleOnboardingNext('allow')}>Allow Verified Sharing</Button>
                  </div>
                </div>
              )}
              {currentOnboardingStep === 'facility' && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ff8f1f]">Facility Verification</p>
                  <h3 className="mt-4 text-3xl font-semibold text-slate-900">{pendingSession.user.verificationBadge || 'Facility verification captured.'}</h3>
                  <p className="mt-4 text-sm leading-6 text-slate-600">{pendingSession.user.role === 'Hospital' ? 'Your HFR-linked facility is now marked as verified by NHA and can participate in trusted medical exchange.' : 'Your blood bank license has been evaluated against the DCGI/HFR registry and workflow permissions will follow that status.'}</p>
                  <div className="mt-8 flex justify-end"><Button size="lg" className="rounded-[1.25rem] bg-[#0b4ea2] hover:bg-[#083c7d]" onClick={() => handleOnboardingNext('continue')}>Enter Verified Dashboard</Button></div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
