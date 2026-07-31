'use client';

import { useCallback, useEffect, useState } from 'react';
import { Hourglass, X, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { registrationsApi } from '@/lib/api';

interface WaitlistEntry {
  id: string;
  ticketTypeId: string | null;
  customerName: string | null;
  customerEmail: string;
  quantity: number;
  status: 'WAITING' | 'OFFERED';
  offerExpiresAt: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<WaitlistEntry['status'], string> = {
  WAITING: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
  OFFERED: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
};

/** OWNER/ADMIN-only view of who's waiting for a sold-out event/tier — FIFO order, with the option to
 *  withdraw someone (e.g. a duplicate or a no-longer-interested request). */
export default function WaitlistPanel({ orgId, productId }: { orgId: string; productId: string }) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await registrationsApi.listWaitlist(orgId, productId); setEntries(res.data ?? []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [orgId, productId]);
  useEffect(() => { void load(); }, [load]);

  const cancel = async (entry: WaitlistEntry) => {
    if (!confirm(`Remove ${entry.customerName || entry.customerEmail} from the waitlist?`)) return;
    setCancelling(entry.id);
    try { await registrationsApi.cancelWaitlistEntry(orgId, entry.id); toast.success('Removed from waitlist'); await load(); }
    catch { toast.error('Could not remove'); } finally { setCancelling(null); }
  };

  if (loading) return null; // avoid flashing an empty panel on every tab switch
  if (entries.length === 0) return null; // no waitlist activity — don't clutter the registrants view

  // FIFO position is 1-based rank within the same tier bucket, WAITING entries only.
  const waitingByTier = new Map<string | null, number>();
  const positionOf = (e: WaitlistEntry) => {
    if (e.status !== 'WAITING') return null;
    const n = (waitingByTier.get(e.ticketTypeId) ?? 0) + 1;
    waitingByTier.set(e.ticketTypeId, n);
    return n;
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Hourglass className="w-3.5 h-3.5 text-zinc-500" />
        <p className="text-xs font-medium text-zinc-500">Waitlist · {entries.length}</p>
      </div>
      <div className="space-y-1.5">
        {entries.map((e) => {
          const position = positionOf(e);
          return (
            <div key={e.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200 truncate">{e.customerName || e.customerEmail}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${STATUS_STYLE[e.status]}`}>
                    {e.status === 'WAITING' ? `#${position}` : 'Offered'}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 truncate">
                  {e.customerEmail} · {e.quantity} ticket{e.quantity === 1 ? '' : 's'}
                  {e.status === 'OFFERED' && e.offerExpiresAt && (
                    <> · <Clock className="inline w-2.5 h-2.5 -mt-0.5" /> claim by {new Date(e.offerExpiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</>
                  )}
                </p>
              </div>
              <button onClick={() => cancel(e)} disabled={cancelling === e.id} title="Remove from waitlist" className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800 disabled:opacity-40">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
