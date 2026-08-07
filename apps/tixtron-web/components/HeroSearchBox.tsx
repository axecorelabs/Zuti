'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

/** Always hands off to /search (client-side push, no full page reload) — the hero is a fast single
 * field; real filtering happens on the dedicated search page's full panel. */
export function HeroSearchBox({ defaultValue, className = '' }: { defaultValue?: string; className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const qs = value.trim() ? `?search=${encodeURIComponent(value.trim())}` : '';
    router.push(`/search${qs}`);
  };

  return (
    <form onSubmit={submit} className={`flex items-center gap-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full pl-6 pr-2 py-2 max-w-lg ${className}`}>
      <Search className="w-5 h-5 text-zinc-500 shrink-0" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search events, venues, or cities…"
        className="flex-1 bg-transparent outline-none text-base text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 py-3.5"
      />
      <button type="submit" className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-6 py-3.5 rounded-full transition-colors whitespace-nowrap">
        Search
      </button>
    </form>
  );
}
