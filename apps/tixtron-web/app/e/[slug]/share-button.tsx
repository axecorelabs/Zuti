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
      className="flex items-center justify-center w-10 h-10 rounded-full bg-black/45 backdrop-blur-sm border border-white/15 text-white"
    >
      {copied ? <Check className="w-[18px] h-[18px]" /> : <Share2 className="w-[17px] h-[17px]" />}
    </button>
  );
}
