import AuthForm from '../../components/AuthForm';
import { Activity } from 'lucide-react';
import Link from 'next/link';

export default function Register() {
  return (
    <div className="min-h-screen bg-brand-dark flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute bottom-[20%] right-[30%] w-[500px] h-[500px] bg-lifered-400/10 rounded-full blur-[120px]" />
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 flex flex-col items-center mb-8">
        <Link href="/" className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-lifered-500/10 rounded-xl border border-lifered-500/20">
            <Activity className="h-8 w-8 text-lifered-500" />
          </div>
        </Link>
        <h2 className="text-center text-3xl font-extrabold text-white">
          Join Life<span className="text-lifered-500">Link</span>
        </h2>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md flex justify-center">
        <AuthForm type="register" />
      </div>
    </div>
  );
}
