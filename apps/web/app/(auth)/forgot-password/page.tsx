'use client';

import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim().toLowerCase());
      toast.success('If an account exists for this email, a reset link has been sent.');
      setEmail('');
    } catch {
      toast.error('Unable to submit request right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[420px] rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white leading-tight">Forgot password</h1>
        <p className="mt-2 text-sm text-zinc-500 font-light">
          Enter your email and we will send you a password reset link.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600 font-light">
          Remembered your password?{' '}
          <Link href="/login" className="text-zinc-400 hover:text-white transition-colors font-normal">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
