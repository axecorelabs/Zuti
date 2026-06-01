'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, ServerCrash } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

type ComponentStatus = 'UP' | 'DEGRADED' | 'DOWN';

type SystemComponent = {
  key: string;
  label: string;
  status: ComponentStatus;
  details: string;
  latencyMs?: number | null;
  meta?: Record<string, unknown>;
};

type SystemHealthPayload = {
  generatedAt: string;
  uptimeSeconds: number;
  summary: {
    total: number;
    up: number;
    degraded: number;
    down: number;
  };
  components: SystemComponent[];
  checks: {
    queueInFlight: number;
    failedDeliveriesLastHour: number;
    failedDeliveriesLastDay: number;
  };
  deliveries: {
    byStatus: Record<string, number>;
  };
  processing: {
    byStatus: Record<string, number>;
  };
  invitations: {
    last24HoursByStatus: Record<string, number>;
  };
  queues: {
    items: Array<{
      key: string;
      label: string;
      redisStatus: string;
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      completed: number;
    }>;
    totals: {
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      completed: number;
    };
  };
};

function toLabel(value: string) {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function statusColor(status: ComponentStatus) {
  if (status === 'UP') return '#22c55e';
  if (status === 'DEGRADED') return '#f59e0b';
  return '#ef4444';
}

function componentHealthScore(status: ComponentStatus) {
  if (status === 'UP') return 100;
  if (status === 'DEGRADED') return 60;
  return 20;
}

function compactLabel(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 14)}...`;
}

const TooltipCard = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
      <p className="mb-0.5 text-zinc-500">{label}</p>
      <p>{payload[0].value}</p>
    </div>
  );
};

const ComponentStateTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">
      <p className="mb-0.5 text-zinc-500">{point?.label ?? 'Component'}</p>
      <p>Score: {payload[0].value}%</p>
    </div>
  );
};

function HealthStatusPill({ failedLastHour }: { failedLastHour: number }) {
  const healthy = failedLastHour === 0;
  return (
    <span
      className={`inline-flex h-7 items-center rounded-full border px-3 text-xs ${
        healthy
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
      }`}
    >
      {healthy ? 'Healthy' : 'Attention needed'}
    </span>
  );
}

export default function SystemPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SystemHealthPayload | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await adminApi.getSystemHealth({ limit: 20 });
        if (!mounted) return;
        setData(res.data as SystemHealthPayload);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const deliveryStatuses = useMemo(
    () => Object.entries(data?.deliveries?.byStatus ?? {}).sort((a, b) => b[1] - a[1]),
    [data],
  );
  const processingStatuses = useMemo(
    () => Object.entries(data?.processing?.byStatus ?? {}).sort((a, b) => b[1] - a[1]),
    [data],
  );
  const invitationStatuses = useMemo(
    () => Object.entries(data?.invitations?.last24HoursByStatus ?? {}).sort((a, b) => b[1] - a[1]),
    [data],
  );

  const statusSummaryChart = useMemo(
    () => [
      { name: 'Up', value: data?.summary?.up ?? 0, color: '#22c55e' },
      { name: 'Degraded', value: data?.summary?.degraded ?? 0, color: '#f59e0b' },
      { name: 'Down', value: data?.summary?.down ?? 0, color: '#ef4444' },
    ].filter((item) => item.value > 0),
    [data],
  );

  const queuePendingChart = useMemo(
    () => (data?.queues?.items ?? []).map((item) => ({
      label: item.label.replace('Queue: ', ''),
      pending: item.waiting + item.active + item.delayed,
      failed: item.failed,
    })),
    [data],
  );

  const componentRows = useMemo(
    () => [...(data?.components ?? [])].sort((a, b) => {
      const rank: Record<ComponentStatus, number> = { DOWN: 0, DEGRADED: 1, UP: 2 };
      return rank[a.status] - rank[b.status];
    }),
    [data],
  );

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">System</h1>
          <p className="mt-1 text-sm font-light text-zinc-500">
            Delivery reliability and operational health indicators for Zuti.
          </p>
        </div>
        <HealthStatusPill failedLastHour={data?.checks?.failedDeliveriesLastHour ?? 0} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs text-zinc-500">System uptime</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">
            {loading ? '—' : formatUptime(data?.uptimeSeconds ?? 0)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">Since last API restart</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Queue in flight</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">
            {loading ? '—' : data?.checks?.queueInFlight ?? 0}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Failed deliveries (1h)</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">
            {loading ? '—' : data?.checks?.failedDeliveriesLastHour ?? 0}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Failed deliveries (24h)</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">
            {loading ? '—' : data?.checks?.failedDeliveriesLastDay ?? 0}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="card p-5">
          <h2 className="text-sm text-white">Component status summary</h2>
          {loading ? (
            <div className="mt-4 h-56 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : statusSummaryChart.length === 0 ? (
            <div className="mt-4 flex h-56 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No status data
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={statusSummaryChart} dataKey="value" nameKey="name" innerRadius={42} outerRadius={65} paddingAngle={4} strokeWidth={0}>
                    {statusSummaryChart.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {statusSummaryChart.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      {entry.name}
                    </div>
                    <span className="text-sm text-white">{entry.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm text-white">Queue load and failures</h2>
          {loading ? (
            <div className="mt-4 h-56 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : queuePendingChart.length === 0 ? (
            <div className="mt-4 flex h-56 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No queue data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={queuePendingChart} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 11 }} />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<TooltipCard />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="pending" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="card p-5">
          <h2 className="text-sm text-white">Monitored components</h2>
          <p className="mt-1 text-xs text-zinc-500">State trend by component (100 = up, 60 = degraded, 20 = down)</p>
          {loading ? (
            <div className="mt-4 h-64 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : componentRows.length === 0 ? (
            <div className="mt-4 flex h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No component state data
            </div>
          ) : (
            <div className="mt-4 h-64 rounded-xl border border-zinc-800 bg-zinc-950/60 px-2 py-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={componentRows.map((component) => ({
                    label: component.label,
                    shortLabel: compactLabel(component.label),
                    score: componentHealthScore(component.status),
                  }))}
                  margin={{ top: 14, right: 18, left: -12, bottom: 22 }}
                >
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="shortLabel" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} />
                  <Tooltip content={<ComponentStateTooltip />} cursor={{ stroke: '#3f3f46', strokeDasharray: '4 4' }} />
                  <Line type="monotone" dataKey="score" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: '#60a5fa' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {componentRows.map((component) => (
              <div key={component.key} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{component.label}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{component.details}</p>
                  </div>
                  <span
                    className="inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px]"
                    style={{ borderColor: `${statusColor(component.status)}44`, color: statusColor(component.status), backgroundColor: `${statusColor(component.status)}1a` }}
                  >
                    {toLabel(component.status)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>Health score {componentHealthScore(component.status)}%</span>
                  <span>{component.latencyMs != null ? `${component.latencyMs}ms` : 'No latency'}</span>
                </div>
              </div>
            ))}
            {!loading && componentRows.length === 0 ? <p className="text-sm text-zinc-500">No components available.</p> : null}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-sm text-white">Health map</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2 text-zinc-400">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Up
              </div>
              <span className="text-white">{data?.summary?.up ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2 text-zinc-400">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Degraded
              </div>
              <span className="text-white">{data?.summary?.degraded ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2 text-zinc-400">
                <ServerCrash className="h-4 w-4 text-red-400" />
                Down
              </div>
              <span className="text-white">{data?.summary?.down ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-sm sm:col-span-2 xl:col-span-1">
              <div className="flex items-center gap-2 text-zinc-400">
                <Database className="h-4 w-4 text-blue-400" />
                Snapshot generated
              </div>
              <span className="text-[11px] text-zinc-300">{data?.generatedAt ? formatDateTime(data.generatedAt) : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h2 className="text-sm text-white">Delivery statuses</h2>
          <div className="mt-4 space-y-2">
            {deliveryStatuses.map(([status, count]) => (
              <div key={status} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                <span className="text-sm text-zinc-400">{toLabel(status)}</span>
                <span className="text-sm text-white">{count}</span>
              </div>
            ))}
            {!loading && deliveryStatuses.length === 0 ? <p className="text-sm text-zinc-500">No delivery data.</p> : null}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-sm text-white">Processing statuses</h2>
          <div className="mt-4 space-y-2">
            {processingStatuses.map(([status, count]) => (
              <div key={status} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                <span className="text-sm text-zinc-400">{toLabel(status)}</span>
                <span className="text-sm text-white">{count}</span>
              </div>
            ))}
            {!loading && processingStatuses.length === 0 ? <p className="text-sm text-zinc-500">No processing data.</p> : null}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-sm text-white">Invitations last 24h</h2>
          <div className="mt-4 space-y-2">
            {invitationStatuses.map(([status, count]) => (
              <div key={status} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                <span className="text-sm text-zinc-400">{toLabel(status)}</span>
                <span className="text-sm text-white">{count}</span>
              </div>
            ))}
            {!loading && invitationStatuses.length === 0 ? <p className="text-sm text-zinc-500">No invitation data.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
