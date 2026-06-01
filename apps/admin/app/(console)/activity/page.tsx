'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';

type ActivityItem = {
  id: string;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
};

export default function ActivityPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await adminApi.listActivity({ limit: 50 });
        if (!mounted) return;
        setItems(Array.isArray(res.data?.items) ? (res.data.items as ActivityItem[]) : []);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Activity</h1>
        <p className="mt-1 text-sm font-light text-zinc-500">Recent actions across every Zuti workspace.</p>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm text-white">Latest events</h2>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-zinc-900 animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-600">No activity yet.</div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {items.map((item) => (
              <div key={item.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{item.actorName}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{item.action} {item.targetType ? `on ${item.targetType}` : ''}</p>
                  </div>
                  <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400">
                    {item.organization?.name ?? 'Unknown workspace'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
