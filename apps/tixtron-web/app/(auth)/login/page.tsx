'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { authApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { TicketMotif } from '@/components/TicketMotif';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, loadFromStorage } = useAuthStore((s) => ({
    user: s.user,
    isLoading: s.isLoading,
    loadFromStorage: s.loadFromStorage,
  }));
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const resolvePostAuthDestination = useCallback(async () => {
    try {
      const orgsRes = await orgsApi.list();
      const orgs = orgsRes.data as { id: string }[];
      return orgs.length === 0 ? '/onboarding' : '/dashboard';
    } catch {
      return '/onboarding';
    }
  }, []);

  useEffect(() => {
    if (!isLoading && user) {
      resolvePostAuthDestination().then((destination) => {
        router.replace(destination);
      });
    }
  }, [isLoading, user, router, resolvePostAuthDestination]);

  useEffect(() => {
    if (searchParams.get('verify') === 'sent') {
      toast.success('Verification email sent. Check your inbox before signing in.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await authApi.login(normalizedEmail, password);
      const { user, accessToken } = res.data;
      setAuth(user, accessToken);

      const destination = await resolvePostAuthDestination();
      router.replace(destination);

      setShowResendVerification(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed';
      const normalized = Array.isArray(msg) ? msg[0] : msg;
      toast.error(normalized);
      setShowResendVerification(
        typeof normalized === 'string' && normalized.toLowerCase().includes('verify your email'),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email) {
      toast.error('Enter your email address first.');
      return;
    }

    setResendingVerification(true);
    try {
      await authApi.resendVerification(email.trim().toLowerCase());
      toast.success('If your account is unverified, a verification link has been sent. Check inbox and spam.');
    } catch {
      toast.error('Could not resend verification email. Please try again.');
    } finally {
      setResendingVerification(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex lg:w-[48%] xl:w-1/2 relative border-r border-zinc-800/60 flex-col overflow-hidden"
        style={{
          backgroundImage:
            'linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.03) 52%, transparent 64%), linear-gradient(135deg, #1a1d22 0%, #14161a 55%, #0F1115 100%)',
        }}
      >
        <TicketMotif />

        <div className="relative z-10 flex flex-col h-full px-12 py-10">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192x192.png" alt="" className="w-8 h-8 rounded-xl" />
            <span className="font-brand font-semibold text-lg tracking-tight text-white">TIXTRON</span>
          </div>

          <div className="flex-1 flex flex-col justify-center max-w-sm">
            <p className="text-xs font-medium text-brand-400 tracking-widest uppercase mb-4">Event Ticketing</p>
            <h2 className="font-brand font-semibold text-[2rem] leading-tight tracking-tight text-white mb-4">
              Every ticket tells<br />the start of a story.
            </h2>
            <p className="text-sm text-zinc-500 font-light leading-relaxed max-w-xs mb-10">
              Manage your events, tickets, and payouts from one place.
            </p>
          </div>

          <p className="text-xs text-zinc-700 font-light">
            © 2026 axecorelabs
          </p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col min-h-screen bg-zinc-950">
        <div className="lg:hidden flex items-center gap-2.5 px-6 pt-8 pb-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192x192.png" alt="" className="w-7 h-7 rounded-lg" />
          <span className="font-brand font-semibold text-base tracking-tight text-white">TIXTRON</span>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[360px]">

            <div className="mb-8">
              <h1 className="font-brand font-semibold text-2xl tracking-tight text-white leading-tight">Sign in</h1>
              <p className="mt-2 text-sm text-zinc-500 font-light">Use your Tixtron (Zuti) account</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs text-zinc-400 mb-2 font-normal tracking-wide">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-base"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-zinc-400 font-normal tracking-wide">Password</label>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-base pr-10"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>

            {showResendVerification ? (
              <div className="mt-4 p-3 rounded-xl border border-amber-600/20 bg-amber-500/10">
                <p className="text-xs text-amber-200/90 mb-2">
                  Your account appears unverified. Request a new verification link.
                </p>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendingVerification}
                  className="text-xs px-3 py-2 rounded-lg border border-amber-500/30 text-amber-100 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
                >
                  {resendingVerification ? 'Sending link...' : 'Resend verification email'}
                </button>
              </div>
            ) : null}

            <p className="mt-8 text-center text-sm text-zinc-600 font-light">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-zinc-400 hover:text-white transition-colors font-normal">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}
