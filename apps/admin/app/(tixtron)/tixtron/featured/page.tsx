'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { tixtronOpsApi } from '@/lib/api';

interface EventItem {
  id: string;
  name: string;
  eventDate: string | null;
  isPublic: boolean;
  isActive: boolean;
  isFeatured: boolean;
  featuredOrder: number | null;
  organizationName: string;
}

export default function TixtronFeaturedPage() {
  const [items, setItems] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    try {
      const res = await tixtronOpsApi.listCurationEvents(query || undefined);
      setItems(res.data.items);
    } catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleFeatured = async (event: EventItem) => {
    setSavingId(event.id);
    try {
      const nextFeatured = !event.isFeatured;
      await tixtronOpsApi.setEventFeatured(event.id, {
        isFeatured: nextFeatured,
        featuredOrder: nextFeatured ? (items.filter((i) => i.isFeatured).length) : undefined,
      });
      await load(q);
    } finally { setSavingId(null); }
  };

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Featured events</h1>
        <p className="text-sm text-zinc-500 mt-1">Curated events surfaced on the public discovery page and the platform digest.</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load(q); }}
          placeholder="Search events…"
          className="input-base pl-9"
        />
      </div>

      {loading ? (
        <div className="h-64 rounded-2xl bg-zinc-900 animate-pulse" />
      ) : items.length === 0 ? (
        <div className="card p-10 text-center text-sm text-zinc-500">No events found</div>
      ) : (
        <div className="card divide-y divide-zinc-800">
          {items.map((ev) => (
            <div key={ev.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">{ev.name}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {ev.organizationName} · {ev.eventDate ? new Date(ev.eventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date'}
                  {!ev.isPublic && ' · not public'}
                </p>
              </div>
              <button
                onClick={() => toggleFeatured(ev)}
                disabled={savingId === ev.id}
                className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 ${
                  ev.isFeatured
                    ? 'bg-amber-500/[0.14] border-amber-500/30 text-amber-400'
                    : 'border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-500/30'
                }`}
              >
                <Star className={`w-3 h-3 ${ev.isFeatured ? 'fill-amber-400' : ''}`} />
                {ev.isFeatured ? 'Featured' : 'Feature'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
