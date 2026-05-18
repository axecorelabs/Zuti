'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, AlertTriangle, Loader2, Leaf } from 'lucide-react';
import { authApi } from '@/lib/api';

type VerifyState = 'loading' | 'success' | 'error';

function VerifyEmailPageContent() {
  const params = useSearchParams();
  const token = useMemo(() => params.get('token') ?? '', [params]);
  const [state, setState] = useState<VerifyState>('loading');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!token) {
        setState('error');
        setMessage('Verification link is missing or invalid.');
        return;
      }

      try {
        const res = await authApi.verifyEmail(token);
        if (!active) return;
        setState('success');
        setMessage(res.data?.message ?? 'Email verified successfully.');
      } catch (err: unknown) {
        if (!active) return;
        const apiMessage =
          (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
            ?.message ?? 'Verification failed';
        const normalized = Array.isArray(apiMessage) ? apiMessage[0] : apiMessage;
        setState('error');
        setMessage(normalized);
      }
    };

    run();
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="w-full max-w-[460px] rounded-2xl border border-zinc-800 bg-zinc-950 p-7">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
        </div>

        <div className="flex items-start gap-3">
          {state === 'loading' ? (
            <Loader2 className="w-5 h-5 text-zinc-300 animate-spin mt-0.5" />
          ) : state === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
          )}

          <div>
            <h1 className="font-brand font-semibold text-xl tracking-tight text-white">
              {state === 'loading'
                ? 'Verifying email'
                : state === 'success'
                ? 'Email verified'
                : 'Verification failed'}
            </h1>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="mt-7 flex items-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors"
          >
            Go to sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-900 text-sm transition-colors"
          >
            Create another account
          </Link>
        </div>
      </div>
    </div>
  );
}

function VerifyEmailFallback() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="w-full max-w-[460px] rounded-2xl border border-zinc-800 bg-zinc-950 p-7">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
        </div>
        <div className="flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-zinc-300 animate-spin mt-0.5" />
          <div>
            <h1 className="font-brand font-semibold text-xl tracking-tight text-white">Verifying email</h1>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">Verifying your email...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailPageContent />
    </Suspense>
  );
}
