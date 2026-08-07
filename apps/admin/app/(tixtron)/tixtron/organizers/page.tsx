'use client';

import { useEffect, useState } from 'react';
import { Building2, Send, Users2 } from 'lucide-react';
import { tixtronOpsApi } from '@/lib/api';

interface OrganizerItem {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  eventCount: number;
  ticketsSold: number;
  hasActiveBot: boolean;
  hasCommunity: boolean;
}

export default function TixtronOrganizersPage() {
  const [items, setItems] = useState<OrganizerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tixtronOpsApi.listOrganizers()
      .then((res) => setItems(res.data.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Organizers</h1>
        <p className="text-sm text-zinc-500 mt-1">Every organization using the ticketing product.</p>
      </div>

      {loading ? (
        <div className="h-64 rounded-2xl bg-zinc-900 animate-pulse" />
      ) : items.length === 0 ? (
        <div className="card p-10 text-center">
          <Building2 className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">No organizers yet</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] text-zinc-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Organizer</th>
                <th className="px-5 py-3 font-medium text-right">Events</th>
                <th className="px-5 py-3 font-medium text-right">Tickets sold</th>
                <th className="px-5 py-3 font-medium">Bot</th>
                <th className="px-5 py-3 font-medium">Community</th>
                <th className="px-5 py-3 font-medium text-right">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {items.map((org) => (
                <tr key={org.id} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-zinc-200 font-medium">{org.name}</p>
                    <p className="text-[11px] text-zinc-600">{org.slug}</p>
                  </td>
                  <td className="px-5 py-3.5 text-right text-zinc-300 tabular-nums">{org.eventCount}</td>
                  <td className="px-5 py-3.5 text-right text-zinc-300 tabular-nums">{org.ticketsSold.toLocaleString()}</td>
                  <td className="px-5 py-3.5">
                    {org.hasActiveBot ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400"><Send className="w-3 h-3" /> Connected</span>
                    ) : (
                      <span className="text-[11px] text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {org.hasCommunity ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-400"><Users2 className="w-3 h-3" /> Set up</span>
                    ) : (
                      <span className="text-[11px] text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right text-[11px] text-zinc-500">
                    {new Date(org.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
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
