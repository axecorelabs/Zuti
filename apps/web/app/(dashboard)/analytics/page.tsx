'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  MessageSquare, TrendingUp, TrendingDown, Bot, Zap, Clock, Star,
  Wifi, Mail, Globe,
} from 'lucide-react';
import { orgsApi, conversationsApi, botsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Org { id: string; name: string; }
interface Bot { id: string; name: string; }

interface Analytics {
  period: { start: string; end: string; days: number };
  totals: { conversations: number; resolved: number; escalated: number; open: number; pending: number };
  rates: { resolutionRate: number | null; escalationRate: number | null; aiResolutionRate: number | null };
  avgFirstResponseSec: number | null;
  channelBreakdown: { WIDGET: number; TELEGRAM: number; EMAIL: number };
  volumeByDay: { date: string; count: number }[];
  csatScore: number | null;
  csatSampleSize: number;
}

const DAYS_OPTIONS = [7, 30, 90] as const;
type Days = typeof DAYS_OPTIONS[number];

function fmt(val: number | null, suffix = '%'): string {
  if (val === null) return '—';
  return `${val}${suffix}`;
}

function fmtSeconds(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function shortDate(iso: string, days: Days): string {
  const d = new Date(iso);
  if (days <= 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const VolumeTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="analytics-tooltip bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300">
        <p className="text-zinc-500 mb-0.5">{label}</p>
        {payload[0].value} conversations
      </div>
    );
  }
  return null;
};

export default function AnalyticsPage() {
  const { getRoleForOrg } = useAuthStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | 'all'>('all');
  const [days, setDays] = useState<Days>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    orgsApi.list().then(async (res) => {
      const orgs: (Org & { members?: { role: string }[] })[] = res.data;
      if (!orgs.length) return;
      setOrg(orgs[0]);
      botsApi.list(orgs[0].id).then((r) => setBots(r.data ?? [])).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!org) return;
    setLoading(true);
    const botId = selectedBotId === 'all' ? undefined : selectedBotId;
    conversationsApi.analytics(org.id, days, botId)
      .then((analyticsRes) => {
        setData(analyticsRes.data);
      })
      .catch(() => {
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [org, days, selectedBotId]);

  const skeleton = (w = 'w-16', h = 'h-7') => (
    <div className={`${w} ${h} bg-zinc-800 animate-pulse rounded`} />
  );

  const rateCard = (
    label: string,
    value: number | null,
    icon: React.ReactNode,
    accent: string,
    subtitle?: string,
  ) => (
    <div className="analytics-stat-card card p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="analytics-stat-label text-xs text-zinc-500 font-normal">{label}</p>
        <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${accent}`}>
          {icon}
        </div>
      </div>
      {loading ? skeleton() : (
        <p className="analytics-stat-value font-brand font-semibold text-3xl text-white tracking-tight">{fmt(value)}</p>
      )}
      {subtitle && <p className="analytics-stat-subtext text-xs text-zinc-600 mt-1">{subtitle}</p>}
    </div>
  );

  const volumeChartData = data?.volumeByDay.map((d) => ({
    ...d,
    label: shortDate(d.date, days),
  })) ?? [];

  // Channel breakdown for simple bar
  const channelData = data
    ? [
        { name: 'Widget', value: data.channelBreakdown.WIDGET, color: '#3b82f6' },
        { name: 'Telegram', value: data.channelBreakdown.TELEGRAM, color: '#06b6d4' },
        { name: 'Email', value: data.channelBreakdown.EMAIL, color: '#a78bfa' },
      ].filter((c) => c.value > 0)
    : [];

  return (
    <div className="analytics-page p-4 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">
            Track customer outcomes, resolution quality, and escalation pressure.
          </p>
        </div>
        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Bot selector */}
          {bots.length > 0 && (
            <select
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            >
              <option value="all">All bots</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  days === d
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="analytics-stat-grid grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {/* Total */}
        <div className="analytics-stat-card card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="analytics-stat-label text-xs text-zinc-500 font-normal">Conversations</p>
            <div className="w-7 h-7 rounded-lg border flex items-center justify-center bg-blue-600/15 border-blue-600/20 text-blue-400">
              <MessageSquare className="w-3.5 h-3.5" />
            </div>
          </div>
          {loading ? skeleton() : (
            <p className="analytics-stat-value font-brand font-semibold text-3xl text-white tracking-tight">{data?.totals.conversations ?? 0}</p>
          )}
          <p className="analytics-stat-subtext text-xs text-zinc-600 mt-1">in {days} days</p>
        </div>

        {/* Resolution rate */}
        {rateCard(
          'Resolution rate',
          data?.rates.resolutionRate ?? null,
          <TrendingUp className="w-3.5 h-3.5" />,
          'bg-emerald-500/15 border-emerald-500/20 text-emerald-400',
          'resolved / (resolved + escalated)',
        )}

        {/* Escalation rate */}
        {rateCard(
          'Escalation rate',
          data?.rates.escalationRate ?? null,
          <TrendingDown className="w-3.5 h-3.5" />,
          'bg-orange-500/15 border-orange-500/20 text-orange-400',
          'conversations escalated to agent',
        )}

        {/* AI resolution */}
        {rateCard(
          'AI resolution rate',
          data?.rates.aiResolutionRate ?? null,
          <Bot className="w-3.5 h-3.5" />,
          'bg-zinc-800 border-zinc-700 text-zinc-400',
          'of resolved handled by AI only',
        )}
      </div>

      {/* Second row — response time + CSAT + channel */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {/* Avg first response */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-zinc-500 font-normal">Avg first response</p>
            <div className="w-7 h-7 rounded-lg border flex items-center justify-center bg-cyan-500/15 border-cyan-500/20 text-cyan-400">
              <Zap className="w-3.5 h-3.5" />
            </div>
          </div>
          {loading ? skeleton() : (
            <p className="font-brand font-semibold text-3xl text-white tracking-tight">
              {fmtSeconds(data?.avgFirstResponseSec ?? null)}
            </p>
          )}
          <p className="text-xs text-zinc-600 mt-1">time to first AI reply</p>
        </div>

        {/* CSAT — placeholder */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-zinc-500 font-normal">CSAT score</p>
            <div className="w-7 h-7 rounded-lg border flex items-center justify-center bg-yellow-500/15 border-yellow-500/20 text-yellow-400">
              <Star className="w-3.5 h-3.5" />
            </div>
          </div>
          {loading ? skeleton() : (
            <p className="font-brand font-semibold text-3xl text-white tracking-tight">
              {data?.csatScore !== null && data?.csatScore !== undefined
                ? `${data.csatScore}%`
                : '—'}
            </p>
          )}
          <p className="text-xs text-zinc-600 mt-1">
            {data?.csatSampleSize ? `${data.csatSampleSize} responses` : 'coming soon'}
          </p>
        </div>

        {/* Resolved count */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-zinc-500 font-normal">Resolved</p>
            <div className="w-7 h-7 rounded-lg border flex items-center justify-center bg-zinc-800 border-zinc-700 text-zinc-400">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          {loading ? skeleton() : (
            <p className="font-brand font-semibold text-3xl text-white tracking-tight">
              {data?.totals.resolved ?? 0}
            </p>
          )}
          <p className="text-xs text-zinc-600 mt-1">
            {data ? `${data.totals.open} open · ${data.totals.escalated} escalated` : ''}
          </p>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Volume trend */}
        <div className="card p-6 lg:col-span-2">
          <div className="mb-6">
            <h2 className="text-sm font-normal text-white">Conversation volume</h2>
            <p className="text-xs text-zinc-600 font-light mt-0.5">Last {days} days</p>
          </div>
          {loading ? (
            <div className="h-44 bg-zinc-900 animate-pulse rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={176}>
              <BarChart data={volumeChartData} barSize={days <= 7 ? 32 : days <= 30 ? 14 : 8}>
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#52525b', fontSize: 11 }}
                  interval={days <= 30 ? 'preserveStartEnd' : Math.floor(days / 10)}
                />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<VolumeTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {volumeChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.count > 0 ? '#3b82f6' : '#27272a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Channel breakdown */}
        <div className="card p-6">
          <div className="mb-6">
            <h2 className="text-sm font-normal text-white">By channel</h2>
            <p className="text-xs text-zinc-600 font-light mt-0.5">Last {days} days</p>
          </div>
          {loading ? (
            <div className="h-44 bg-zinc-900 animate-pulse rounded-xl" />
          ) : channelData.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-xs text-zinc-600">No data yet</div>
          ) : (
            <div className="space-y-4 pt-2">
              {[
                { key: 'WIDGET', label: 'Widget', icon: <Globe className="w-3.5 h-3.5" />, color: 'bg-blue-500' },
                { key: 'TELEGRAM', label: 'Telegram', icon: <Wifi className="w-3.5 h-3.5" />, color: 'bg-cyan-500' },
                { key: 'EMAIL', label: 'Email', icon: <Mail className="w-3.5 h-3.5" />, color: 'bg-violet-500' },
              ].map(({ key, label, icon, color }) => {
                const count = data?.channelBreakdown[key as keyof typeof data.channelBreakdown] ?? 0;
                const total = data?.totals.conversations ?? 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="text-zinc-500">{icon}</span>
                        {label}
                      </div>
                      <span className="text-xs text-zinc-500">{count}</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} rounded-full transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Status breakdown table */}
      <div className="card p-6">
        <h2 className="text-sm font-normal text-white mb-5">Status summary</h2>
        {loading ? (
          <div className="h-20 bg-zinc-900 animate-pulse rounded-xl" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Open', value: data?.totals.open ?? 0, dot: 'bg-blue-500' },
              { label: 'Pending', value: data?.totals.pending ?? 0, dot: 'bg-zinc-500' },
              { label: 'Resolved', value: data?.totals.resolved ?? 0, dot: 'bg-emerald-500' },
              { label: 'Escalated', value: data?.totals.escalated ?? 0, dot: 'bg-red-500' },
            ].map(({ label, value, dot }) => (
              <div key={label} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                <div>
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="text-lg font-brand font-semibold text-white">{value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
