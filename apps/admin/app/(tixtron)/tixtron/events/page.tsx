'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Loader2, Plus } from 'lucide-react';
import { tixtronOpsApi } from '@/lib/api';
import { useTixtronContext } from '@/lib/use-tixtron-context';

interface EventItem {
  id: string;
  name: string;
  eventDate: string | null;
  isActive: boolean;
  isFree: boolean;
}

export default function TixtronEventsPage() {
  const { organizationId, loading: contextLoading, error: contextError } = useTixtronContext();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [isFree, setIsFree] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const res = await tixtronOpsApi.listEvents(organizationId);
      setEvents(res.data as EventItem[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!organizationId || !name.trim()) { setError('Enter an event name.'); return; }
    setError(null);
    setCreating(true);
    try {
      await tixtronOpsApi.createEvent(organizationId, {
        name: name.trim(), isFree, requiresApproval: false, fields: [],
        eventDate: eventDate ? new Date(eventDate).toISOString() : undefined,
      });
      setName(''); setEventDate(''); setIsFree(true); setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not create event');
    } finally { setCreating(false); }
  };

  if (contextLoading) return <div className="p-4 md:p-8"><div className="h-40 rounded-2xl bg-zinc-900 animate-pulse" /></div>;
  if (contextError) return <div className="p-4 md:p-8"><div className="card p-6 text-sm text-red-400">{contextError}</div></div>;

  return (
    <div className="space-y-6 p-4 md:p-8 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Events</h1>
          <p className="text-sm text-zinc-500 mt-1">Events hosted directly by Tixtron itself, if any.</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-secondary">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> New event
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-sm text-red-400">{error}</div>}

      {showForm && (
        <div className="card p-6 space-y-3">
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Event name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tixtron Launch Night" className="input-base" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Event date (optional)</label>
            <input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="input-base" />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
            Free event
          </label>
          <button onClick={create} disabled={creating} className="btn-primary w-full">
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
            {creating ? 'Creating…' : 'Create event'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="h-40 rounded-2xl bg-zinc-900 animate-pulse" />
      ) : events.length === 0 ? (
        <div className="card p-8 text-center">
          <CalendarDays className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">No events yet</p>
        </div>
      ) : (
        <div className="card divide-y divide-zinc-800">
          {events.map((ev) => (
            <div key={ev.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm text-zinc-200">{ev.name}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {ev.eventDate ? new Date(ev.eventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date set'} · {ev.isFree ? 'Free' : 'Paid'}
                </p>
              </div>
              <span className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${ev.isActive ? 'bg-emerald-500/[0.12] text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                {ev.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
