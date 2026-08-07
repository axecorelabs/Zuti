'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, CalendarDays, X } from 'lucide-react';

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Today" / "This weekend" / "This week" as real date ranges, computed from the browser's local
 * clock — these are what most casual browsers actually think in, rather than picking an exact
 * calendar date. Weekend = the upcoming Saturday/Sunday (or today onward, if today already is one). */
function quickRange(kind: 'today' | 'weekend' | 'week'): { from: string; to: string } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = now.getDay(); // 0 = Sun .. 6 = Sat

  if (kind === 'today') {
    return { from: toDateStr(now), to: toDateStr(now) };
  }
  if (kind === 'weekend') {
    const satOffset = day === 6 ? 0 : day === 0 ? -1 : 6 - day;
    const sat = new Date(now);
    sat.setDate(now.getDate() + satOffset);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    const from = day === 0 ? now : sat; // Sunday: the Saturday half already passed, clamp to today
    return { from: toDateStr(from), to: toDateStr(sun) };
  }
  // week: today through the end of this calendar week (Sunday)
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return { from: toDateStr(now), to: toDateStr(sunday) };
}

const QUICK_RANGES: { key: 'today' | 'weekend' | 'week'; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'week', label: 'This week' },
];

/** Always navigates to /search (client-side, no full reload) — this is the one shared entry point
 * for real search, whether triggered from here, the hero's simpler box, or resubmitted from the
 * search page itself. Search/location/date filter live as you type/pick (debounced ~400ms so a
 * request isn't fired on every keystroke) — category isn't editable here but is carried through
 * every navigation this component makes, so live-typing a search term never silently drops an
 * active category filter picked via the pills above the results. */
export function EventSearchPanel({ defaultSearch, defaultCity, defaultDateFrom, defaultDateTo, defaultCategory }: {
  defaultSearch?: string; defaultCity?: string; defaultDateFrom?: string; defaultDateTo?: string; defaultCategory?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(defaultSearch ?? '');
  const [city, setCity] = useState(defaultCity ?? '');
  const [dateFrom, setDateFrom] = useState(defaultDateFrom ?? '');
  const [dateTo, setDateTo] = useState(defaultDateTo ?? '');

  const buildHref = (overrides?: { dateFrom?: string; dateTo?: string }) => {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    if (city.trim()) qs.set('city', city.trim());
    if (defaultCategory) qs.set('category', defaultCategory);
    const from = overrides?.dateFrom ?? dateFrom;
    const to = overrides?.dateTo ?? dateTo;
    if (from) qs.set('dateFrom', from);
    if (to) qs.set('dateTo', to);
    return qs.toString() ? `/search?${qs.toString()}` : '/search';
  };

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const handle = setTimeout(() => {
      router.push(buildHref(), { scroll: false });
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, city, dateFrom, dateTo, defaultCategory]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(buildHref());
  };

  // Quick-range chips apply instantly (like the category pills) rather than waiting on the debounce
  // — they're a toggle, not free-form input to compose.
  const applyQuickRange = (kind: 'today' | 'weekend' | 'week') => {
    const { from, to } = quickRange(kind);
    setDateFrom(from);
    setDateTo(to);
    router.push(buildHref({ dateFrom: from, dateTo: to }));
  };

  const clearDates = () => {
    setDateFrom('');
    setDateTo('');
    router.push(buildHref({ dateFrom: '', dateTo: '' }));
  };

  const isQuickActive = (kind: 'today' | 'weekend' | 'week') => {
    const r = quickRange(kind);
    return defaultDateFrom === r.from && defaultDateTo === r.to;
  };
  const hasActiveRange = Boolean(defaultDateTo);

  return (
    <div>
      <form
        onSubmit={submit}
        className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-0 max-w-3xl mx-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl sm:rounded-full p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-zinc-300 dark:focus-within:border-zinc-700"
      >
        <label className="flex items-center gap-2.5 flex-1 min-w-0 rounded-full px-3.5 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60 focus-within:bg-zinc-50 dark:focus-within:bg-zinc-800/60">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-400 leading-tight">Search event</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full bg-transparent outline-none text-[13px] text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
            />
          </span>
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>

        <div className="hidden sm:block w-px h-8 bg-zinc-200 dark:bg-zinc-800 shrink-0" />

        <label className="flex items-center gap-2.5 flex-1 min-w-0 rounded-full px-3.5 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60 focus-within:bg-zinc-50 dark:focus-within:bg-zinc-800/60">
          <MapPin className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-400 leading-tight">Location</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Any city"
              className="w-full bg-transparent outline-none text-[13px] text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
            />
          </span>
          {city && (
            <button type="button" onClick={() => setCity('')} aria-label="Clear location" className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>

        <div className="hidden sm:block w-px h-8 bg-zinc-200 dark:bg-zinc-800 shrink-0" />

        <label className="flex items-center gap-2.5 flex-1 min-w-0 rounded-full px-3.5 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60 focus-within:bg-zinc-50 dark:focus-within:bg-zinc-800/60">
          <CalendarDays className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-400 leading-tight">Date</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setDateTo(''); }}
              className="w-full bg-transparent outline-none text-[13px] text-zinc-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
            />
          </span>
          {dateFrom && (
            <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }} aria-label="Clear date" className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>

        <button
          type="submit"
          className="bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-full transition-colors shrink-0 sm:ml-1"
        >
          Search
        </button>
      </form>

      <div className="flex items-center gap-2 flex-wrap justify-center mt-3">
        {QUICK_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => applyQuickRange(r.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              isQuickActive(r.key)
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
            }`}
          >
            {r.label}
          </button>
        ))}
        {hasActiveRange && (
          <button type="button" onClick={clearDates} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            <X className="w-3 h-3" /> Clear dates
          </button>
        )}
      </div>
    </div>
  );
}
