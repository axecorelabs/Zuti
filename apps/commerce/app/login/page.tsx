'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { setAuthTokens } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await authApi.login(email, password);
      const accessToken = String(res.data?.accessToken ?? '');
      const refreshToken = String(res.data?.refreshToken ?? '');
      if (!accessToken || !refreshToken) {
        throw new Error('Invalid auth response');
      }
      setAuthTokens(accessToken, refreshToken);
      router.push('/dashboard');
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg[0] : msg || 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8 bg-black">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6">
          <p className="text-xs text-zinc-500 font-light tracking-widest uppercase mb-3">Zuti Commerce</p>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">Use your existing Zuti credentials.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="input-base"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="input-base"
          />
          {error ? <p className="text-sm text-red-400 font-light">{error}</p> : null}
          <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
