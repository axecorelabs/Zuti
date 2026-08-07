'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { tixtronOpsApi } from '@/lib/api';

interface SubscriberItem {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  marketingConsentAt: string;
  firstSeenAt: string;
}

export default function TixtronSubscribersPage() {
  const [items, setItems] = useState<SubscriberItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tixtronOpsApi.listEmailSubscribers()
      .then((res) => setItems(res.data.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Email list</h1>
          <p className="text-sm text-zinc-500 mt-1">Ticket buyers who opted in to Tixtron&apos;s own updates, from any organizer&apos;s event.</p>
        </div>
        {!loading && <span className="text-sm text-zinc-500 tabular-nums">{items.length.toLocaleString()} subscriber{items.length === 1 ? '' : 's'}</span>}
      </div>

      {loading ? (
        <div className="h-64 rounded-2xl bg-zinc-900 animate-pulse" />
      ) : items.length === 0 ? (
        <div className="card p-10 text-center">
          <Mail className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">No subscribers yet</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] text-zinc-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium text-right">Subscribed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {items.map((s) => (
                <tr key={s.id} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="px-5 py-3.5 text-zinc-200">{s.displayName ?? '—'}</td>
                  <td className="px-5 py-3.5 text-zinc-300">{s.primaryEmail}</td>
                  <td className="px-5 py-3.5 text-right text-[11px] text-zinc-500">
                    {new Date(s.marketingConsentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
