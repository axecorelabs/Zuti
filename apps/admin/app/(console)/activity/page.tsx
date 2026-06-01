'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await adminApi.listActivity({ limit: pageSize, page });
        if (!mounted) return;
        setItems(Array.isArray(res.data?.items) ? (res.data.items as ActivityItem[]) : []);
        setTotal(Number(res.data?.total ?? 0));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [page]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Activity</h1>
        <p className="mt-1 text-sm font-light text-zinc-500">Recent actions across every Zuti workspace.</p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm text-white">Latest events</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || page <= 1}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300 transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <span className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={loading || page >= totalPages}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300 transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
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
