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
      <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px', borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399', fontWeight: 600, fontSize: 13, margin: 0 }}>
        <CheckCircle2 style={{ width: 14, height: 14 }} /> You&apos;re signed up for updates
      </p>
    );
  }

  return (
    <button
      onClick={optIn}
      disabled={state === 'loading'}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '11px 16px', borderRadius: 12, border: '1px solid #3f3f46', backgroundColor: 'transparent',
        color: '#d4d4d8', fontWeight: 600, fontSize: 13, cursor: state === 'loading' ? 'default' : 'pointer',
        opacity: state === 'loading' ? 0.6 : 1,
      }}
    >
      <Mail style={{ width: 14, height: 14 }} /> {state === 'loading' ? 'Signing up…' : 'Yes, send me event updates by email'}
      {state === 'error' && <span style={{ color: '#f87171', marginLeft: 4 }}>— try again</span>}
    </button>
  );
}
