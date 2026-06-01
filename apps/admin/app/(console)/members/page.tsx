'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';

type OperationTask = {
  id: string;
  actionType: string;
  status: string;
  priority: string;
  summary: string;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
};

type PendingInvite = {
  id: string;
  email: string;
  role: 'ADMIN' | 'AGENT';
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  invitedBy: {
    id: string;
    name: string | null;
    email: string;
  };
};

type FailedDelivery = {
  id: string;
  status: string;
  channel: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  actionTask: {
    id: string;
    actionType: string;
    status: string;
  };
};

type OperationsPayload = {
  queue: {
    total: number;
    countsByStatus: Record<string, number>;
    items: OperationTask[];
  };
  invites: {
    pending: number;
    items: PendingInvite[];
  };
  deliveries: {
    failedOrRetrying: number;
    items: FailedDelivery[];
  };
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function toLabel(value: string) {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function MembersPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OperationsPayload | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await adminApi.getOperations({ limit: 25 });
        if (!mounted) return;
        setData(res.data as OperationsPayload);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const queueStatusEntries = Object.entries(data?.queue.countsByStatus ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Operations</h1>
        <p className="mt-1 text-sm font-light text-zinc-500">
          Queue pressure, invitation backlog, and delivery incidents that need human follow-up.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Queue items</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : data?.queue.total ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Pending invitations</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : data?.invites.pending ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Failed/retrying deliveries</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : data?.deliveries.failedOrRetrying ?? 0}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
          <h2 className="text-sm text-white">Queue breakdown</h2>
          <div className="mt-4 space-y-2">
            {loading
              ? [...Array(6)].map((_, index) => <div key={index} className="h-10 rounded-xl bg-zinc-900 animate-pulse" />)
              : queueStatusEntries.map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                    <span className="text-sm text-zinc-400">{toLabel(status)}</span>
                    <span className="text-sm text-white">{count}</span>
                  </div>
                ))}
            {!loading && queueStatusEntries.length === 0 ? (
              <p className="text-sm text-zinc-500">No queue data available.</p>
            ) : null}
          </div>
        </div>

        <div className="card overflow-hidden lg:col-span-2">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm text-white">Recent action tasks</h2>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {(data?.queue.items ?? []).slice(0, 8).map((task) => (
              <div key={task.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{task.summary}</p>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {toLabel(task.actionType)} · {task.organization.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex h-6 items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 text-[11px] text-zinc-300">
                      {toLabel(task.status)}
                    </span>
                    <p className="mt-1 text-[11px] text-zinc-600">{formatDateTime(task.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))}
            {!loading && (data?.queue.items ?? []).length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-600">No action tasks found.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm text-white">Pending invitations</h2>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {(data?.invites.items ?? []).slice(0, 8).map((invite) => (
              <div key={invite.id} className="px-5 py-3">
                <p className="text-sm text-white">{invite.email}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {toLabel(invite.role)} in {invite.organization.name} · invited by {invite.invitedBy.name || invite.invitedBy.email}
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">{formatDateTime(invite.createdAt)}</p>
              </div>
            ))}
            {!loading && (data?.invites.items ?? []).length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-600">No pending invitations.</div>
            ) : null}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm text-white">Delivery incidents</h2>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {(data?.deliveries.items ?? []).slice(0, 8).map((incident) => (
              <div key={incident.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-white">{incident.organization.name}</p>
                  <span className="text-xs text-zinc-400">{toLabel(incident.channel)}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {toLabel(incident.status)} · {toLabel(incident.actionTask.actionType)}
                </p>
                <p className="mt-1 text-xs text-zinc-600 line-clamp-2">
                  {incident.errorMessage || incident.errorCode || 'No error details available'}
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">{formatDateTime(incident.createdAt)}</p>
              </div>
            ))}
            {!loading && (data?.deliveries.items ?? []).length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-600">No delivery incidents.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-500">
        For deep user or workspace actions, continue in <Link href="/users" className="text-zinc-300 hover:text-white">Users</Link> and <Link href="/workspaces" className="text-zinc-300 hover:text-white">Workspaces</Link>.
      </div>
    </div>
  );
}
