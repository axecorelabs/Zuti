'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { adminApi } from '@/lib/api';

type WorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  _count: {
    members: number;
    bots: number;
    conversations: number;
    commerceStores: number;
  };
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function WorkspacesPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await adminApi.listWorkspaces({ limit: 100 });
        if (!mounted) return;
        setItems(Array.isArray(res.data?.items) ? (res.data.items as WorkspaceItem[]) : []);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;

    return items.filter((item) => item.name.toLowerCase().includes(normalizedQuery) || item.slug.toLowerCase().includes(normalizedQuery));
  }, [items, query]);

  const stats = {
    total: items.length,
    members: items.reduce((sum, item) => sum + item._count.members, 0),
    bots: items.reduce((sum, item) => sum + item._count.bots, 0),
    stores: items.reduce((sum, item) => sum + item._count.commerceStores, 0),
  };

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Workspaces</h1>
        <p className="mt-1 text-sm font-light text-zinc-500">
          Every organization running on Zuti, with a compact operational snapshot.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs text-zinc-500">All workspaces</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.total}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Members</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.members}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Bots</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.bots}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Stores</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.stores}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-zinc-800 px-5 py-5 md:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="font-brand text-xl text-white">
                All workspaces <span className="text-zinc-500">{filteredItems.length}</span>
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Search by workspace name or slug and open a separate detail page.
              </p>
            </div>

            <label className="relative block sm:min-w-[280px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workspaces"
                className="input-base h-11 rounded-2xl border-zinc-700/80 bg-zinc-900/80 pl-11"
              />
            </label>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-4 md:p-6">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="h-20 rounded-2xl bg-zinc-900 animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-zinc-400">No workspaces match the current search.</p>
            <p className="mt-1 text-xs text-zinc-600">Try a broader name or slug query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800/80">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-zinc-600">
                  <th className="px-6 py-3 font-medium">Workspace</th>
                  <th className="px-6 py-3 font-medium">Members</th>
                  <th className="px-6 py-3 font-medium">Bots</th>
                  <th className="px-6 py-3 font-medium">Conversations</th>
                  <th className="px-6 py-3 font-medium">Stores</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium" />
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-800/60">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="group hover:bg-zinc-900/35">
                    <td className="px-6 py-4">
                      <Link href={`/workspaces/${item.id}`} className="block min-w-0">
                        <p className="truncate text-sm text-white transition-colors group-hover:text-zinc-100">{item.name}</p>
                        <p className="mt-1 truncate text-xs text-zinc-500">/{item.slug}</p>
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300">{item._count.members}</td>
                    <td className="px-6 py-4 text-sm text-zinc-300">{item._count.bots}</td>
                    <td className="px-6 py-4 text-sm text-zinc-300">{item._count.conversations}</td>
                    <td className="px-6 py-4 text-sm text-zinc-300">{item._count.commerceStores}</td>
                    <td className="px-6 py-4 text-sm text-zinc-400">{formatDate(item.createdAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/workspaces/${item.id}`} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200">
                        Open
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && items.length === 0 ? (
        <div className="card mt-4 p-8 text-center text-sm text-zinc-600">No workspaces found.</div>
      ) : null}
    </div>
  );
}