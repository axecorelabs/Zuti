'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Building2, MessagesSquare, Shield, Users, Wallet } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi } from '@/lib/api';

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

type UserItem = { createdAt: string };
type WorkspaceItem = { id: string; name: string; createdAt: string; _count: { members: number; bots: number } };
type ActivityItem = { action: string; createdAt: string };
type CashflowPayload = {
  summary: {
    billing: Array<{ currency: string; _sum: { amountMinor: number | null } }>;
    commerce: Array<{ currency: string; _sum: { amountMinor: number | null } }>;
  };
};

function formatMoney(amountMinor: number | null | undefined) {
  return ((amountMinor ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function dayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function shortDayLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { weekday: 'short' });
}

function buildDailySeries(items: Array<{ createdAt: string }>, days = 7) {
  const today = new Date();
  const buckets = new Map<string, number>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    buckets.set(dayKey(date.toISOString()), 0);
  }

  items.forEach((item) => {
    const key = dayKey(item.createdAt);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  });

  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

const ROLE_COLORS: Record<string, string> = {
  Owners: '#60a5fa',
  Admins: '#f59e0b',
  Agents: '#22c55e',
};

const REVENUE_COLORS: Record<string, string> = {
  Billing: '#3b82f6',
  Commerce: '#a78bfa',
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

export default function AdminDashboardPage() {
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
          adminApi.listActivity({ limit: 200 }),
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

  const roleChart = [
    { name: 'Owners', value: overview?.counts.owners ?? 0 },
    { name: 'Admins', value: overview?.counts.admins ?? 0 },
    { name: 'Agents', value: overview?.counts.agents ?? 0 },
  ].filter((entry) => entry.value > 0);

  const revenueChart = [
    { name: 'Billing', value: overview?.counts.billingRevenueMinor ?? 0 },
    { name: 'Commerce', value: overview?.counts.commerceRevenueMinor ?? 0 },
  ].filter((entry) => entry.value > 0);

  const activityTrend = useMemo(() => buildDailySeries(activity, 7), [activity]);
  const userTrend = useMemo(() => buildDailySeries(users, 7), [users]);
  const workspaceTrend = useMemo(() => buildDailySeries(workspaces, 7), [workspaces]);
  const topWorkspaces = useMemo(
    () => [...workspaces]
      .sort((left, right) => right._count.members - left._count.members)
      .slice(0, 6)
      .map((workspace) => ({
        name: workspace.name,
        members: workspace._count.members,
        bots: workspace._count.bots,
      })),
    [workspaces],
  );

  const cards = [
    { label: 'Total users', value: overview?.counts.totalUsers ?? 0, icon: Users },
    { label: 'Workspaces', value: overview?.counts.totalOrganizations ?? 0, icon: Building2 },
    { label: 'Active bots', value: overview?.counts.activeBots ?? 0, icon: Bot },
    { label: 'Open conversations', value: overview?.counts.openConversations ?? 0, icon: MessagesSquare },
    { label: 'Platform revenue', value: formatMoney(overview?.counts.totalRevenueMinor ?? 0), icon: Wallet },
  ];

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          {loading ? <span className="inline-block h-7 w-44 rounded-lg bg-zinc-900 animate-pulse" /> : 'Zuti Super Admin'}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Platform-wide visibility across users, workspaces, conversations, revenue, and live operational activity.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="card p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs text-zinc-500">{card.label}</p>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300">
                  <Icon className="h-3.5 w-3.5" />
                </div>
              </div>
              {loading ? (
                <div className="h-7 w-12 rounded bg-zinc-800 animate-pulse" />
              ) : (
                <p className="font-brand text-3xl font-semibold tracking-tight text-white">{card.value}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm text-white">Activity trend</h2>
              <p className="mt-1 text-xs text-zinc-600">Recent platform events by day.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-400">
              <Activity className="h-3.5 w-3.5" />
              Latest 7 days
            </div>
          </div>
          {loading ? (
            <div className="mt-6 h-52 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={activityTrend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="activityTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDayLabel} axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 11 }} />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<TooltipCard suffix=" events" />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fill="url(#activityTrendFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-sm text-white">Role distribution</h2>
          <p className="mt-1 text-xs text-zinc-600">All user memberships across the platform.</p>
          {loading ? (
            <div className="mt-6 h-48 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : roleChart.length === 0 ? (
            <div className="mt-6 flex h-48 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No role data yet
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={roleChart} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={4} strokeWidth={0}>
                    {roleChart.map((entry) => (
                      <Cell key={entry.name} fill={ROLE_COLORS[entry.name] ?? '#71717a'} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
                          <p className="text-zinc-500">{payload[0].name}</p>
                          <p>{payload[0].value} members</p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {roleChart.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROLE_COLORS[entry.name] ?? '#71717a' }} />
                      {entry.name}
                    </div>
                    <span className="text-white">{entry.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-6">
          <h2 className="text-sm text-white">Revenue split</h2>
          <p className="mt-1 text-xs text-zinc-600">Incoming cashflow grouped by platform sources.</p>
          {loading ? (
            <div className="mt-6 h-48 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : revenueChart.length === 0 ? (
            <div className="mt-6 flex h-48 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No revenue data yet
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={revenueChart} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={4} strokeWidth={0}>
                    {revenueChart.map((entry) => (
                      <Cell key={entry.name} fill={REVENUE_COLORS[entry.name] ?? '#71717a'} />
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
                {revenueChart.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: REVENUE_COLORS[entry.name] ?? '#71717a' }} />
                      {entry.name}
                    </div>
                    <span className="text-white">{formatMoney(entry.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card p-6 xl:col-span-2">
          <h2 className="text-sm text-white">Workspace leaderboard</h2>
          <p className="mt-1 text-xs text-zinc-600">Top workspaces by member count, with bot volume as a secondary signal.</p>
          {loading ? (
            <div className="mt-6 h-48 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : topWorkspaces.length === 0 ? (
            <div className="mt-6 flex h-48 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No workspace data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topWorkspaces} layout="vertical" margin={{ top: 8, right: 18, left: 18, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={120} tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
                        <p className="mb-0.5 text-zinc-500">{payload[0].payload.name}</p>
                        <p>{payload[0].payload.members} members</p>
                        <p>{payload[0].payload.bots} bots</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="members" radius={[0, 8, 8, 0]} fill="#3b82f6" barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="card p-6">
          <h2 className="text-sm text-white">Created trend</h2>
          <p className="mt-1 text-xs text-zinc-600">User and workspace growth during the latest 7-day window.</p>
          {loading ? (
            <div className="mt-6 h-52 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={activityTrend.map((point, index) => ({
                  date: point.date,
                  label: shortDayLabel(point.date),
                  users: userTrend[index]?.count ?? 0,
                  workspaces: workspaceTrend[index]?.count ?? 0,
                }))}
                margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
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
                        <p>Users: {payload.find((item) => item.dataKey === 'users')?.value ?? 0}</p>
                        <p>Workspaces: {payload.find((item) => item.dataKey === 'workspaces')?.value ?? 0}</p>
                      </div>
                    );
                  }}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Bar dataKey="users" stackId="created" radius={[4, 4, 0, 0]} fill="#3b82f6" />
                <Bar dataKey="workspaces" stackId="created" radius={[4, 4, 0, 0]} fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm text-white">Recent activity</h2>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {(activity ?? []).slice(0, 6).map((item) => (
              <div key={`${item.action}-${item.createdAt}`} className="px-5 py-3">
                <p className="text-sm text-white">{item.action}</p>
                <p className="mt-1 text-xs text-zinc-500">{new Date(item.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
            {!loading && activity.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-600">No recent activity.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-500">
        The overview combines {users.length} users, {workspaces.length} workspaces, and {cashflow?.summary.billing.length ?? 0} billing currency groups into one command center.
      </div>
    </div>
  );
}
