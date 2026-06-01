'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, Users, Wallet, Activity } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi } from '@/lib/api';

type UserItem = { createdAt: string };

type WorkspaceItem = {
  id: string;
  name: string;
  createdAt: string;
  _count: { members: number; bots: number; conversations: number };
};

type ActivityItem = { action: string; createdAt: string };

type CashflowPayload = {
  summary: {
    billing: Array<{ currency: string; _sum: { amountMinor: number | null }; _count: { _all: number } }>;
    commerce: Array<{ currency: string; _sum: { amountMinor: number | null }; _count: { _all: number } }>;
  };
};

type Overview = {
  counts: {
    totalUsers: number;
    totalOrganizations: number;
    owners: number;
    admins: number;
    agents: number;
    activeBots: number;
    openConversations: number;
    commerceStores: number;
    totalRevenueMinor: number;
    billingRevenueMinor: number;
    commerceRevenueMinor: number;
  };
};

function dayKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shortDayLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildDailySeries(items: Array<{ createdAt: string }>, days = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = new Map<string, number>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    buckets.set(dayKey(date), 0);
  }

  items.forEach((item) => {
    const key = dayKey(item.createdAt);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  });

  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

function formatMoney(amountMinor: number | null | undefined) {
  return ((amountMinor ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const SOURCE_COLORS: Record<string, string> = {
  Billing: '#3b82f6',
  Commerce: '#a78bfa',
};

const METRIC_COLORS: Record<string, string> = {
  Users: '#60a5fa',
  Workspaces: '#a78bfa',
  Activity: '#f59e0b',
  Revenue: '#22c55e',
};

const TooltipCard = ({ active, payload, label, suffix = '' }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
      <p className="mb-0.5 text-zinc-500">{label}</p>
      <p>{payload[0].value}{suffix}</p>
    </div>
  );
};

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [cashflow, setCashflow] = useState<CashflowPayload | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [overviewRes, usersRes, workspacesRes, activityRes, cashflowRes] = await Promise.all([
          adminApi.getOverview(),
          adminApi.listUsers({ limit: 500 }),
          adminApi.listWorkspaces({ limit: 500 }),
          adminApi.listActivity({ limit: 500 }),
          adminApi.getCashflow({ limit: 50 }),
        ]);

        if (!mounted) return;

        setOverview(overviewRes.data as Overview);
        setUsers(Array.isArray(usersRes.data?.items) ? (usersRes.data.items as UserItem[]) : []);
        setWorkspaces(Array.isArray(workspacesRes.data?.items) ? (workspacesRes.data.items as WorkspaceItem[]) : []);
        setActivity(Array.isArray(activityRes.data?.items) ? (activityRes.data.items as ActivityItem[]) : []);
        setCashflow(cashflowRes.data as CashflowPayload);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const userTrend = useMemo(() => buildDailySeries(users, 30), [users]);
  const workspaceTrend = useMemo(() => buildDailySeries(workspaces, 30), [workspaces]);

  const growthTrend = useMemo(() => {
    const workspaceMap = new Map(workspaceTrend.map((point) => [point.date, point.count]));
    return userTrend.map((point) => ({
      date: point.date,
      label: shortDayLabel(point.date),
      users: point.count,
      workspaces: workspaceMap.get(point.date) ?? 0,
    }));
  }, [userTrend, workspaceTrend]);

  const actionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    activity.forEach((item) => {
      counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([action, count]) => ({ action, count }));
  }, [activity]);

  const sourceTotals = useMemo(() => {
    const billingTotal = (cashflow?.summary.billing ?? []).reduce((sum, item) => sum + (item._sum.amountMinor ?? 0), 0);
    const commerceTotal = (cashflow?.summary.commerce ?? []).reduce((sum, item) => sum + (item._sum.amountMinor ?? 0), 0);
    return [
      { name: 'Billing', value: billingTotal },
      { name: 'Commerce', value: commerceTotal },
    ].filter((item) => item.value > 0);
  }, [cashflow]);

  const sourceCurrencyRows = useMemo(() => {
    const rows = new Map<string, { billing: number; commerce: number }>();

    (cashflow?.summary.billing ?? []).forEach((item) => {
      const current = rows.get(item.currency) ?? { billing: 0, commerce: 0 };
      current.billing += item._sum.amountMinor ?? 0;
      rows.set(item.currency, current);
    });

    (cashflow?.summary.commerce ?? []).forEach((item) => {
      const current = rows.get(item.currency) ?? { billing: 0, commerce: 0 };
      current.commerce += item._sum.amountMinor ?? 0;
      rows.set(item.currency, current);
    });

    return Array.from(rows.entries()).map(([currency, value]) => ({ currency, billing: value.billing, commerce: value.commerce }));
  }, [cashflow]);

  const topWorkspaces = useMemo(
    () => [...workspaces]
      .sort((left, right) => right._count.members - left._count.members)
      .slice(0, 8),
    [workspaces],
  );

  const metrics = [
    { label: 'Users', value: overview?.counts.totalUsers ?? 0, icon: Users },
    { label: 'Workspaces', value: overview?.counts.totalOrganizations ?? 0, icon: Building2 },
    { label: 'Activity', value: activity.length, icon: Activity },
    { label: 'Revenue', value: formatMoney(overview?.counts.totalRevenueMinor ?? 0), icon: Wallet },
  ];

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Analytics</h1>
          <p className="mt-1 text-sm font-light text-zinc-500">
            Trends, breakdowns, and leaderboard views across the Zuti platform.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-xs text-zinc-400">
          <BarChart3 className="h-3.5 w-3.5" />
          Recharts-powered dashboard
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="card p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs text-zinc-500">{metric.label}</p>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300">
                  <Icon className="h-3.5 w-3.5" />
                </div>
              </div>
              {loading ? (
                <div className="h-7 w-16 rounded bg-zinc-800 animate-pulse" />
              ) : (
                <p className="font-brand text-3xl font-semibold tracking-tight text-white">{metric.value}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm text-white">User and workspace growth</h2>
              <p className="mt-1 text-xs text-zinc-600">Daily creation volume over the latest 30-day window.</p>
            </div>
            <div className="text-xs text-zinc-500">30 days</div>
          </div>
          {loading ? (
            <div className="h-64 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={growthTrend}
                margin={{ top: 10, right: 8, left: -20, bottom: 0 }}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 11 }} />
                <YAxis hide allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
                        <p className="mb-0.5 text-zinc-500">{label}</p>
                        <p>Users: {payload.find((entry) => entry.dataKey === 'users')?.value ?? 0}</p>
                        <p>Workspaces: {payload.find((entry) => entry.dataKey === 'workspaces')?.value ?? 0}</p>
                      </div>
                    );
                  }}
                  cursor={{ stroke: 'rgba(255,255,255,0.05)' }}
                />
                <Legend />
                <Line type="monotone" dataKey="users" name="Users" stroke="#60a5fa" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="workspaces" name="Workspaces" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-sm text-white">Revenue sources</h2>
          <p className="mt-1 text-xs text-zinc-600">Total billing versus commerce revenue.</p>
          {loading ? (
            <div className="mt-4 h-60 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : sourceTotals.length === 0 ? (
            <div className="mt-4 flex h-60 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No revenue data yet
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={sourceTotals} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={4} strokeWidth={0}>
                    {sourceTotals.map((entry) => (
                      <Cell key={entry.name} fill={SOURCE_COLORS[entry.name] ?? '#71717a'} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
                          <p className="text-zinc-500">{payload[0].name}</p>
                          <p>{formatMoney(Number(payload[0].value))}</p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {sourceTotals.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[entry.name] ?? '#71717a' }} />
                      {entry.name}
                    </div>
                    <span className="text-white">{formatMoney(entry.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <h2 className="text-sm text-white">Event mix</h2>
          <p className="mt-1 text-xs text-zinc-600">Most common admin-visible action types in the latest activity batch.</p>
          {loading ? (
            <div className="h-64 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : actionCounts.length === 0 ? (
            <div className="mt-4 flex h-60 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No activity yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={actionCounts} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="action" interval={0} angle={-20} textAnchor="end" height={60} axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<TooltipCard suffix=" events" />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-sm text-white">Top workspaces</h2>
          <p className="mt-1 text-xs text-zinc-600">Largest workspaces by member count.</p>
          <div className="mt-4 space-y-2">
            {topWorkspaces.length === 0 && !loading ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-600">No workspaces yet</div>
            ) : null}
            {topWorkspaces.map((workspace) => (
              <div key={workspace.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{workspace.name}</p>
                    <p className="mt-1 text-xs text-zinc-500">/{workspace.id.slice(0, 6)}</p>
                  </div>
                  <p className="text-sm text-white">{workspace._count.members}</p>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-zinc-900">
                  <div
                    className="h-1.5 rounded-full bg-blue-500"
                    style={{ width: `${Math.min(100, Math.max(8, (workspace._count.members / Math.max(1, topWorkspaces[0]?._count.members ?? 1)) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-sm text-white">Cashflow by currency</h2>
          <p className="mt-1 text-xs text-zinc-600">Billing and commerce grouped by currency.</p>
          {loading ? (
            <div className="h-64 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : sourceCurrencyRows.length === 0 ? (
            <div className="mt-4 flex h-60 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No currency data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sourceCurrencyRows} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="currency" axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 11 }} />
                <YAxis hide allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
                        <p className="mb-0.5 text-zinc-500">{label}</p>
                        <p>Billing: {formatMoney(Number(payload.find((item) => item.dataKey === 'billing')?.value ?? 0))}</p>
                        <p>Commerce: {formatMoney(Number(payload.find((item) => item.dataKey === 'commerce')?.value ?? 0))}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="billing" stackId="cashflow" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="commerce" stackId="cashflow" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm text-white">Recent activity</h2>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {(activity ?? []).slice(0, 8).map((item) => (
              <div key={`${item.action}-${item.createdAt}`} className="px-5 py-3">
                <p className="text-sm text-white">{item.action}</p>
                <p className="mt-1 text-xs text-zinc-500">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {!loading && activity.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-600">No recent activity.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-500">
        Analytics combines {users.length} users, {workspaces.length} workspaces, and {activity.length} activity rows for operational trend analysis.
      </div>
    </div>
  );
}