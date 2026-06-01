'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Search } from 'lucide-react';
import {
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

type BotChannel = 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';

type BotItem = {
  id: string;
  name: string;
  organization: { id: string; name: string; slug: string };
  primaryChannel: BotChannel;
  template: 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL';
  isActive: boolean;
  actionForwardingEnabled: boolean;
  routeToRoles: string[];
  channels: {
    telegram: { connected: boolean; username: string | null };
    widget: { enabled: boolean; key: string | null; allowedDomainsCount: number };
    email: { enabled: boolean; address: string | null };
    whatsapp: {
      enabled: boolean;
      provider: 'META' | 'TWILIO' | null;
      identifier: string | null;
      phoneNumber: string | null;
    };
  };
  skills: string[];
  workload: {
    totalConversations: number;
    openConversations: number;
    pendingConversations: number;
    escalatedConversations: number;
    resolvedConversations: number;
    lastMessageAt: string | null;
  };
  alerts: string[];
  alertsCount: number;
  createdAt: string;
  updatedAt: string;
};

type BotsPayload = {
  total: number;
  summary: {
    totalBots: number;
    activeBots: number;
    inactiveBots: number;
    botsWithAlerts: number;
    forwardingEnabled: number;
    primaryChannelCounts: Record<BotChannel, number>;
    totalOpenConversations: number;
    totalEscalatedConversations: number;
  };
  items: BotItem[];
};

function toLabel(value: string) {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return 'No activity';
  return new Date(value).toLocaleString();
}

function channelClass(channel: BotChannel) {
  if (channel === 'TELEGRAM') return 'border-sky-500/25 bg-sky-500/10 text-sky-300';
  if (channel === 'WEB_WIDGET') return 'border-violet-500/25 bg-violet-500/10 text-violet-300';
  if (channel === 'EMAIL') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
}

const CHANNEL_COLORS: Record<BotChannel, string> = {
  TELEGRAM: '#38bdf8',
  WEB_WIDGET: '#8b5cf6',
  EMAIL: '#22c55e',
  WHATSAPP: '#f59e0b',
};

const TooltipCard = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
      <p className="mb-1 text-zinc-500">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-3">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function BotsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BotsPayload | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [channelFilter, setChannelFilter] = useState<'ALL' | BotChannel>('ALL');

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await adminApi.listBots({ limit: 300 });
        if (!mounted) return;
        setData(res.data as BotsPayload);
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
    const items = data?.items ?? [];
    const normalized = query.trim().toLowerCase();

    return items.filter((item) => {
      const matchesQuery = !normalized
        || item.name.toLowerCase().includes(normalized)
        || item.organization.name.toLowerCase().includes(normalized)
        || item.organization.slug.toLowerCase().includes(normalized)
        || item.skills.some((skill) => skill.toLowerCase().includes(normalized));

      const matchesStatus = statusFilter === 'ALL'
        || (statusFilter === 'ACTIVE' ? item.isActive : !item.isActive);

      const matchesChannel = channelFilter === 'ALL' || item.primaryChannel === channelFilter;

      return matchesQuery && matchesStatus && matchesChannel;
    });
  }, [data?.items, query, statusFilter, channelFilter]);

  const channelDistribution = useMemo(
    () => (Object.entries(data?.summary?.primaryChannelCounts ?? {}) as Array<[BotChannel, number]>)
      .map(([channel, count]) => ({ channel, count, color: CHANNEL_COLORS[channel] }))
      .filter((item) => item.count > 0),
    [data?.summary?.primaryChannelCounts],
  );

  const workloadByBot = useMemo(
    () => [...filteredItems]
      .sort((a, b) => (b.workload.openConversations + b.workload.escalatedConversations) - (a.workload.openConversations + a.workload.escalatedConversations))
      .slice(0, 10)
      .map((item) => ({
        bot: item.name.length > 18 ? `${item.name.slice(0, 18)}...` : item.name,
        open: item.workload.openConversations,
        escalated: item.workload.escalatedConversations,
      })),
    [filteredItems],
  );

  const alertByWorkspace = useMemo(() => {
    const rows = new Map<string, { workspace: string; alerts: number; bots: number }>();

    for (const item of filteredItems) {
      const key = item.organization.id;
      const current = rows.get(key) ?? { workspace: item.organization.name, alerts: 0, bots: 0 };
      current.alerts += item.alertsCount;
      current.bots += 1;
      rows.set(key, current);
    }

    return [...rows.values()]
      .sort((a, b) => b.alerts - a.alerts)
      .slice(0, 8);
  }, [filteredItems]);

  const summary = data?.summary;

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Bots</h1>
        <p className="mt-1 text-sm font-light text-zinc-500">
          Central management for bot status, channel readiness, forwarding posture, and workload health.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Total bots</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : summary?.totalBots ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Active bots</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : summary?.activeBots ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Bots with alerts</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : summary?.botsWithAlerts ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Open / escalated conversations</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">
            {loading ? '—' : `${summary?.totalOpenConversations ?? 0} / ${summary?.totalEscalatedConversations ?? 0}`}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5">
          <h2 className="text-sm text-white">Primary channel mix</h2>
          {loading ? (
            <div className="mt-4 h-64 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : channelDistribution.length === 0 ? (
            <div className="mt-4 flex h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">No channel data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={channelDistribution} dataKey="count" nameKey="channel" innerRadius={48} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                    {channelDistribution.map((entry) => (
                      <Cell key={entry.channel} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {channelDistribution.map((entry) => (
                  <div key={entry.channel} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      {toLabel(entry.channel)}
                    </div>
                    <span className="text-white">{entry.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card p-5 xl:col-span-2">
          <h2 className="text-sm text-white">Highest workload bots</h2>
          <p className="mt-1 text-xs text-zinc-600">Open and escalated conversations by bot.</p>
          {loading ? (
            <div className="mt-4 h-64 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : workloadByBot.length === 0 ? (
            <div className="mt-4 flex h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">No workload data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={workloadByBot} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bot" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} />
                <Tooltip content={<TooltipCard />} />
                <Bar dataKey="open" name="Open" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="escalated" name="Escalated" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm text-white">Alert concentration by workspace</h2>
        {loading ? (
          <div className="mt-4 h-64 rounded-2xl bg-zinc-900 animate-pulse" />
        ) : alertByWorkspace.length === 0 ? (
          <div className="mt-4 flex h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">No alerts in current filter</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={alertByWorkspace} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="workspace" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} />
              <Tooltip content={<TooltipCard />} />
              <Bar dataKey="alerts" name="Alerts" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-zinc-800 px-5 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="font-brand text-xl text-white">Bots registry</h2>
              <p className="mt-1 text-sm text-zinc-500">Track readiness signals, conversation load, and escalation pressure.</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block min-w-[260px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search bot, workspace, skill"
                  className="input-base h-11 rounded-2xl border-zinc-700/80 bg-zinc-900/80 pl-11"
                />
              </label>

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
                className="input-base h-11 rounded-2xl border-zinc-700/80 bg-zinc-900/80"
              >
                <option value="ALL">All status</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              <select
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value as 'ALL' | BotChannel)}
                className="input-base h-11 rounded-2xl border-zinc-700/80 bg-zinc-900/80"
              >
                <option value="ALL">All channels</option>
                <option value="TELEGRAM">Telegram</option>
                <option value="WEB_WIDGET">Widget</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-4 md:p-6">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="h-20 rounded-2xl bg-zinc-900 animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-zinc-400">No bots match the current filters.</p>
            <p className="mt-1 text-xs text-zinc-600">Try broader filters or search terms.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800/80">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-zinc-600">
                  <th className="px-6 py-3 font-medium">Bot</th>
                  <th className="px-6 py-3 font-medium">Workspace</th>
                  <th className="px-6 py-3 font-medium">Primary channel</th>
                  <th className="px-6 py-3 font-medium">Workload</th>
                  <th className="px-6 py-3 font-medium">Alerts</th>
                  <th className="px-6 py-3 font-medium">Last activity</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-800/60">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-900/35">
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300">
                          <Bot className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm text-white">{item.name}</p>
                          <p className="mt-1 text-xs text-zinc-500">{toLabel(item.template)} • {item.skills.length ? item.skills.join(', ') : 'No skills'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300">
                      <p>{item.organization.name}</p>
                      <p className="text-xs text-zinc-500">/{item.organization.slug}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs ${channelClass(item.primaryChannel)}`}>
                        {toLabel(item.primaryChannel)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300">
                      <p>Open {item.workload.openConversations} • Escalated {item.workload.escalatedConversations}</p>
                      <p className="text-xs text-zinc-500">Total {item.workload.totalConversations}</p>
                    </td>
                    <td className="px-6 py-4">
                      {item.alertsCount > 0 ? (
                        <div className="max-w-[16rem]">
                          <div className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            {item.alertsCount} alert{item.alertsCount > 1 ? 's' : ''}
                          </div>
                          <p className="mt-1 truncate text-xs text-zinc-500">{item.alerts[0]}</p>
                        </div>
                      ) : (
                        <span className="inline-flex h-7 items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs text-emerald-300">Healthy</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-400">{formatDate(item.workload.lastMessageAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
