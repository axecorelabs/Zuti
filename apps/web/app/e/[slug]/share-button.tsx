'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';

export default function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const onShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch { /* dismissed */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* noop */ }
  };
  return (
    <button
      type="button"
      onClick={onShare}
      aria-label="Share event"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 40, height: 40, borderRadius: '50%',
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer',
      }}
    >
      {copied ? <Check style={{ width: 18, height: 18 }} /> : <Share2 style={{ width: 17, height: 17 }} />}
    </button>
  );
}
