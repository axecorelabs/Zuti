'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function LandingEmailSignup() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setState('loading');
    try {
      const res = await fetch(`${API_URL}/api/public/community/email-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-4 h-4" /> You&apos;re on the list — thanks for signing up.
      </p>
    );
  }

  return (
    <div>
      <form onSubmit={submit} className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full pl-5 pr-1.5 py-1.5">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 py-2"
        />
        <button
          type="submit"
          disabled={state === 'loading'}
          className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2.5 rounded-full transition-colors whitespace-nowrap"
        >
          {state === 'loading' ? 'Signing up…' : 'Subscribe'}
        </button>
      </form>
      {state === 'error' && <p className="text-xs text-red-500 dark:text-red-400 mt-2">Something went wrong — please try again.</p>}
    </div>
  );
}
