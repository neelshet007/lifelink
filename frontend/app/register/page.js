import { Suspense } from 'react';
import AuthForm from '../../components/AuthForm';
import { Activity, Shield } from 'lucide-react';
import Link from 'next/link';

export default function Register() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_42%,#f8fafc_100%)] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[14%] left-[12%] h-[320px] w-[320px] rounded-full bg-[#0b4ea2]/8 blur-[120px]" />
        <div className="absolute bottom-[10%] right-[10%] h-[260px] w-[260px] rounded-full bg-[#ff8f1f]/10 blur-[110px]" />
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-4xl relative z-10 flex flex-col items-center mb-8">
        <Link href="/" className="flex items-center gap-3 mb-5">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Shield className="h-6 w-6 text-[#0b4ea2]" />
            <Activity className="h-6 w-6 text-[#ff8f1f]" />
          </div>
        </Link>
        <p className="text-xs uppercase tracking-[0.34em] text-[#ff8f1f]">Get Started</p>
        <h2 className="mt-4 text-center text-4xl font-semibold text-slate-900">
          Enter LifeLink through the <span className="text-[#0b4ea2]">National Health Gateway</span>
        </h2>
        <p className="mt-4 max-w-2xl text-center text-sm leading-6 text-slate-600">
          No separate LifeLink signup. Connect once with ABHA, HFR, or DCGI verification and we initialize your profile on return.
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-4xl flex justify-center relative z-10 px-4">
        <Suspense fallback={null}>
          <AuthForm />
        </Suspense>
      </div>
    </div>
  );
}
