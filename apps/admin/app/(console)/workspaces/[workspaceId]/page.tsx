'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, CreditCard, Mail, Users2 } from 'lucide-react';
import { adminApi } from '@/lib/api';

type WorkspaceMember = {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
    createdAt: string;
  };
};

type WorkspaceDetail = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  billing: {
    plan: 'STARTER' | 'GROWTH' | 'SCALE' | 'ENTERPRISE';
    messageCount: number;
    messageLimit: number;
    creditBalanceUnits: number;
    committedMonthlyCreditsUnits: number;
    creditBalance: number;
    committedMonthlyCredits: number;
    commitmentRenewsAt: string | null;
    renewsAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  members: WorkspaceMember[];
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

function formatRoleLabel(role: 'OWNER' | 'ADMIN' | 'AGENT') {
  if (role === 'OWNER') return 'Owner';
  if (role === 'ADMIN') return 'Admin';
  return 'Agent';
}

function rolePillClass(role: 'OWNER' | 'ADMIN' | 'AGENT') {
  if (role === 'OWNER') return 'border-zinc-700 bg-zinc-900/70 text-zinc-200';
  if (role === 'ADMIN') return 'border-zinc-700 bg-zinc-900/70 text-zinc-300';
  return 'border-zinc-700 bg-zinc-900/70 text-zinc-400';
}

export default function WorkspaceDetailsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = String(params?.workspaceId ?? '');
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await adminApi.getWorkspace(workspaceId);
        if (!mounted) return;
        setWorkspace((res.data?.item ?? null) as WorkspaceDetail | null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (workspaceId) {
      load();
    } else {
      setLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [workspaceId]);

  const stats = useMemo(() => {
    return workspace
      ? {
          members: workspace._count.members,
          bots: workspace._count.bots,
          conversations: workspace._count.conversations,
          stores: workspace._count.commerceStores,
        }
      : null;
  }, [workspace]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-col gap-4 border-b border-zinc-900 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Link href="/workspaces" className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" />
            Back to workspaces
          </Link>
          <div>
            <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Workspace details</h1>
            <p className="mt-1 text-sm font-light text-zinc-500">
              A compact profile for the workspace, aligned with the Zuti dashboard style.
            </p>
          </div>
        </div>

        {workspace ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
            {workspace.slug}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Members</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats?.members ?? '—'}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Bots</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats?.bots ?? '—'}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Conversations</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats?.conversations ?? '—'}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Stores</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats?.stores ?? '—'}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="card h-40 animate-pulse bg-zinc-950/70" />
          <div className="card h-72 animate-pulse bg-zinc-950/70" />
        </div>
      ) : workspace ? (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="card overflow-hidden">
              <div className="border-b border-zinc-800 px-5 py-5 md:px-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-600">Workspace</p>
                    <h2 className="mt-1 font-brand text-xl text-white">{workspace.name}</h2>
                    <p className="mt-1 text-sm text-zinc-500">/{workspace.slug}</p>
                  </div>
                  <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-400">
                    Created {formatDate(workspace.createdAt)}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 border-b border-zinc-800 px-5 py-5 md:grid-cols-3 md:px-6">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Plan</p>
                  <p className="mt-2 text-sm text-white">{workspace.billing?.plan ?? 'No billing record'}</p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Messages</p>
                  <p className="mt-2 text-sm text-white">
                    {workspace.billing ? `${workspace.billing.messageCount} / ${workspace.billing.messageLimit}` : '—'}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Credits</p>
                  <p className="mt-2 text-sm text-white">
                    {workspace.billing ? workspace.billing.creditBalance.toFixed(2) : '—'}
                  </p>
                </div>
              </div>

              <div className="px-5 py-5 md:px-6">
                <div className="mb-4 flex items-center gap-2 text-zinc-500">
                  <Users2 className="h-4 w-4" />
                  <p className="text-[11px] uppercase tracking-[0.22em]">Members</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-zinc-800/80">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-zinc-600">
                        <th className="px-0 py-3 font-medium">User</th>
                        <th className="px-0 py-3 font-medium">Role</th>
                        <th className="px-0 py-3 font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {workspace.members.map((member) => (
                        <tr key={member.id} className="group hover:bg-zinc-900/20">
                          <td className="py-4 pr-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-white">{member.user.name || 'Unnamed user'}</p>
                              <p className="mt-1 truncate text-xs text-zinc-500">{member.user.email}</p>
                            </div>
                          </td>
                          <td className="py-4 pr-4">
                            <span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] leading-none ${rolePillClass(member.role)}`}>
                              {formatRoleLabel(member.role)}
                            </span>
                          </td>
                          <td className="py-4 text-sm text-zinc-400">{formatDate(member.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <div className="flex items-center gap-2 text-zinc-500">
                <CreditCard className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.22em]">Billing</p>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                  <span className="text-zinc-500">Plan</span>
                  <span className="text-zinc-200">{workspace.billing?.plan ?? 'None'}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                  <span className="text-zinc-500">Balance</span>
                  <span className="text-zinc-200">{workspace.billing ? workspace.billing.creditBalance.toFixed(2) : '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                  <span className="text-zinc-500">Monthly credits</span>
                  <span className="text-zinc-200">{workspace.billing ? workspace.billing.committedMonthlyCredits.toFixed(2) : '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Renews</span>
                  <span className="text-zinc-200">{workspace.billing?.renewsAt ? formatDate(workspace.billing.renewsAt) : '—'}</span>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 text-zinc-500">
                <Mail className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.22em]">Workspace metadata</p>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                  <span className="text-zinc-500">Slug</span>
                  <span className="text-zinc-200">/{workspace.slug}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                  <span className="text-zinc-500">Members</span>
                  <span className="text-zinc-200">{workspace._count.members}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                  <span className="text-zinc-500">Bots</span>
                  <span className="text-zinc-200">{workspace._count.bots}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Stores</span>
                  <span className="text-zinc-200">{workspace._count.commerceStores}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-sm text-zinc-500">Workspace not found.</div>
      )}
    </div>
  );
}