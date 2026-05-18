'use client';

import { useState } from 'react';
import { Leaf } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.register(name, email, password);
      toast.success('Account created. Check your email to verify your account.');
      router.push('/login?verify=sent');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Registration failed';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex">
      {/* ── Left panel ── */}
      <div className="hidden lg:flex lg:w-[48%] xl:w-1/2 relative bg-zinc-950 border-r border-zinc-900 flex-col overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, #27272a 1px, transparent 1px)', backgroundSize: '32px 32px', opacity: 0.35 }} />
        {/* Glows */}
        <div className="absolute -top-32 left-1/3 w-[480px] h-[480px] bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col h-full px-12 py-10">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
              <Leaf className="w-4 h-4 text-white" />
            </div>
            <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
          </div>

          {/* Hero */}
          <div className="flex-1 flex flex-col justify-center">
            <p className="text-xs font-medium text-blue-400 tracking-widest uppercase mb-4">Get started free</p>
            <h2 className="font-brand font-semibold text-[2rem] leading-tight tracking-tight text-white mb-4">
              Set up your workspace<br />in minutes.
            </h2>
            <p className="text-sm text-zinc-500 font-light leading-relaxed max-w-xs mb-10">
              Create your account, connect a Telegram bot, and start handling customer conversations with AI right away.
            </p>

            <div className="space-y-4">
              {[
                { label: 'No credit card required', desc: 'Free to get started' },
                { label: 'Connect any Telegram bot', desc: 'Just paste your bot token' },
                { label: 'AI replies in seconds', desc: 'Automated support from day one' },
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

          {/* Footer */}
          <p className="text-xs text-zinc-700 font-light">
            © 2026 axecorelabs
          </p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile logo bar */}
        <div className="lg:hidden flex items-center gap-2.5 px-6 pt-8 pb-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/25">
            <Leaf className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-brand font-semibold text-base tracking-tight text-white">Zuti</span>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[360px]">

            <div className="mb-8">
              <h1 className="font-brand font-semibold text-2xl tracking-tight text-white leading-tight">Create your account</h1>
              <p className="mt-2 text-sm text-zinc-500 font-light">Get started — it only takes a minute</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs text-zinc-400 mb-2 font-normal tracking-wide">Full name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-base"
                  placeholder="Jane Smith"
                  autoComplete="name"
                />
              </div>

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
                <label className="block text-xs text-zinc-400 mb-2 font-normal tracking-wide">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-base"
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {loading ? 'Creating account…' : 'Get started'}
                </button>
              </div>
            </form>

            <p className="mt-8 text-center text-sm text-zinc-600 font-light">
              Already have an account?{' '}
              <Link href="/login" className="text-zinc-400 hover:text-white transition-colors font-normal">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
