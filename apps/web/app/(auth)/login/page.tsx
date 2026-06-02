'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Leaf } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';
import { resolveNoWorkspaceRoute } from '@/lib/no-workspace-flow';
import { useAuthStore } from '@/lib/store';

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

  const resolvePostAuthDestination = useCallback(async (_nextUser: { role?: 'USER' | 'MANAGER' }) => {
    try {
      const orgsRes = await (await import('@/lib/api')).orgsApi.list();
      const orgs = orgsRes.data as { id: string }[];
      if (orgs.length === 0) {
        return resolveNoWorkspaceRoute();
      }
      return '/dashboard';
    } catch {
      return resolveNoWorkspaceRoute();
    }
  }, []);

  useEffect(() => {
    if (!isLoading && user) {
      resolvePostAuthDestination(user).then((destination) => {
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
      const { user, accessToken, refreshToken } = res.data;
      setAuth(user, accessToken, refreshToken);

      const destination = await resolvePostAuthDestination(user);
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
    <div className="min-h-screen bg-[#020817] flex">
      {/* ── Left panel ── */}
      <div className="hidden lg:flex lg:w-[48%] xl:w-1/2 relative bg-[#020817] border-r border-zinc-900 flex-col overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, #27272a 1px, transparent 1px)', backgroundSize: '32px 32px', opacity: 0.35 }} />
        {/* Top glow */}
        <div className="absolute -top-32 left-1/3 w-[480px] h-[480px] bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />
        {/* Bottom glow */}
        <div className="absolute -bottom-24 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-2xl pointer-events-none" />

        {/* Content — fixed 3-zone layout with explicit padding */}
        <div className="relative z-10 flex flex-col h-full px-12 py-10">
          {/* Zone 1: Brand — top */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
              <Leaf className="w-4 h-4 text-white" />
            </div>
            <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
          </div>

          {/* Zone 2: Hero copy — vertically centred */}
          <div className="flex-1 flex flex-col justify-center">
            <p className="text-xs font-medium text-blue-400 tracking-widest uppercase mb-4">Customer Support Platform</p>
            <h2 className="font-brand font-semibold text-[2rem] leading-tight tracking-tight text-white mb-4">
              AI-powered support,<br />built for teams.
            </h2>
            <p className="text-sm text-zinc-500 font-light leading-relaxed max-w-xs mb-10">
              Connect your support channels, automate responses with AI, and step in when it matters most.
            </p>

            <div className="space-y-4">
              {[
                { label: 'Multi-channel bot management', desc: 'Connect and manage support bots' },
                { label: 'AI-first conversations', desc: 'Handles routine questions instantly, 24/7' },
                { label: 'Human escalation', desc: 'Take over any conversation in one click' },
              ].map(({ label, desc }) => (
                <div key={label} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-blue-600/20 border border-blue-500/25 flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-zinc-300 font-normal leading-snug">{label}</p>
                    <p className="text-xs text-zinc-600 font-light mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Zone 3: Footer — bottom */}
          <p className="text-xs text-zinc-700 font-light">
            © 2026 axecorelabs
          </p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col min-h-screen bg-[#020817]">
        {/* Mobile logo bar */}
        <div className="lg:hidden flex items-center gap-2.5 px-6 pt-8 pb-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/25">
            <Leaf className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-brand font-semibold text-base tracking-tight text-white">Zuti</span>
        </div>

        {/* Form — centred in the remaining space */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[360px]">

            {/* Heading block */}
            <div className="mb-8">
              <h1 className="font-brand font-semibold text-2xl tracking-tight text-white leading-tight">Welcome back</h1>
              <p className="mt-2 text-sm text-zinc-500 font-light">Sign in to continue to your workspace</p>
            </div>

            {/* Form fields */}
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
                <div className="mt-2 text-right">
                  <Link href="/forgot-password" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    Forgot password?
                  </Link>
                </div>
              </div>

              {/* CTA — extra top margin to visually separate from fields */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
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

            {/* Footer link — separated with more breathing room */}
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
    <div className="min-h-screen bg-[#020817] flex items-center justify-center">
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
