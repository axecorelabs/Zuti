'use client';

import { useState } from 'react';
import { Mail, CheckCircle2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function EmailOptInButton({ entryId }: { entryId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const optIn = async () => {
    setState('loading');
    try {
      const res = await fetch(`${API_URL}/api/public/tickets/${entryId}/email-optin`, { method: 'POST' });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <p className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-400 font-semibold text-[13px]">
        <CheckCircle2 className="w-3.5 h-3.5" /> You&apos;re signed up for updates
      </p>
    );
  }

  return (
    <button
      onClick={optIn}
      disabled={state === 'loading'}
      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 font-semibold text-[13px] hover:border-brand-600/40 hover:text-brand-400 transition-colors disabled:opacity-50"
    >
      <Mail className="w-3.5 h-3.5" /> {state === 'loading' ? 'Signing up…' : 'Yes, send me event updates by email'}
      {state === 'error' && <span className="text-red-400 ml-1">— try again</span>}
    </button>
  );
}
