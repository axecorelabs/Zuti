'use client';

import { useEffect, useMemo, useState } from 'react';
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

type MoneySummary = {
  currency: string;
  _sum: { amountMinor: number | null };
  _count: { _all: number };
};

type BillingTransaction = {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
};

type CommercePayment = {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
  order: { id: string };
};

type CashflowPayload = {
  summary: {
    billing: MoneySummary[];
    commerce: MoneySummary[];
  };
  recent: {
    billingTransactions: BillingTransaction[];
    commercePayments: CommercePayment[];
  };
};

function formatMoney(amountMinor: number | null | undefined) {
  return ((amountMinor ?? 0) / 100).toLocaleString();
}

function formatDayLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const CHART_COLORS = {
  billing: '#3b82f6',
  commerce: '#22c55e',
  surface: '#a1a1aa',
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

export default function CashflowPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CashflowPayload | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await adminApi.getCashflow({ limit: 50 });
        if (!mounted) return;
        setData(res.data as CashflowPayload);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const billingRows = data?.summary?.billing ?? [];
  const commerceRows = data?.summary?.commerce ?? [];
  const billingRecent = data?.recent?.billingTransactions ?? [];
  const commerceRecent = data?.recent?.commercePayments ?? [];

  const summaryStats = useMemo(() => {
    const billingTxCount = billingRows.reduce((sum, row) => sum + (row._count._all ?? 0), 0);
    const commerceTxCount = commerceRows.reduce((sum, row) => sum + (row._count._all ?? 0), 0);
    const currencies = new Set([...billingRows.map((row) => row.currency), ...commerceRows.map((row) => row.currency)]);
    return {
      billingTxCount,
      commerceTxCount,
      totalTxCount: billingTxCount + commerceTxCount,
      currencies: currencies.size,
    };
  }, [billingRows, commerceRows]);

  const sourceMixChart = useMemo(
    () => [
      { name: 'Billing', value: summaryStats.billingTxCount, color: CHART_COLORS.billing },
      { name: 'Commerce', value: summaryStats.commerceTxCount, color: CHART_COLORS.commerce },
    ].filter((item) => item.value > 0),
    [summaryStats],
  );

  const currencyComparisonChart = useMemo(() => {
    const byCurrency = new Map<string, { currency: string; billing: number; commerce: number }>();

    for (const item of billingRows) {
      const existing = byCurrency.get(item.currency) ?? { currency: item.currency, billing: 0, commerce: 0 };
      existing.billing += (item._sum.amountMinor ?? 0) / 100;
      byCurrency.set(item.currency, existing);
    }

    for (const item of commerceRows) {
      const existing = byCurrency.get(item.currency) ?? { currency: item.currency, billing: 0, commerce: 0 };
      existing.commerce += (item._sum.amountMinor ?? 0) / 100;
      byCurrency.set(item.currency, existing);
    }

    return [...byCurrency.values()].sort((a, b) => b.billing + b.commerce - (a.billing + a.commerce));
  }, [billingRows, commerceRows]);

  const inflowTrendChart = useMemo(() => {
    const dayMap = new Map<string, { day: string; label: string; billing: number; commerce: number }>();

    for (const tx of billingRecent) {
      const day = tx.createdAt.slice(0, 10);
      const existing = dayMap.get(day) ?? { day, label: formatDayLabel(tx.createdAt), billing: 0, commerce: 0 };
      existing.billing += 1;
      dayMap.set(day, existing);
    }

    for (const tx of commerceRecent) {
      const day = tx.createdAt.slice(0, 10);
      const existing = dayMap.get(day) ?? { day, label: formatDayLabel(tx.createdAt), billing: 0, commerce: 0 };
      existing.commerce += 1;
      dayMap.set(day, existing);
    }

    return [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-14);
  }, [billingRecent, commerceRecent]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Cashflow</h1>
        <p className="mt-1 text-sm font-light text-zinc-500">Incoming revenue across subscriptions, credits, and commerce orders.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Billing transactions</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : summaryStats.billingTxCount}</p>
          <p className="mt-1 text-[11px] text-zinc-600">Successful subscription and credit charges</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Commerce payments</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : summaryStats.commerceTxCount}</p>
          <p className="mt-1 text-[11px] text-zinc-600">Successful order payments</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Total successful payments</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : summaryStats.totalTxCount}</p>
          <p className="mt-1 text-[11px] text-zinc-600">Billing + commerce combined</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Active currencies</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{loading ? '—' : summaryStats.currencies}</p>
          <p className="mt-1 text-[11px] text-zinc-600">Unique currencies in current snapshot</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="card p-5">
          <h2 className="text-sm text-white">Transaction inflow trend (last 14 days)</h2>
          {loading ? (
            <div className="mt-4 h-72 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : inflowTrendChart.length === 0 ? (
            <div className="mt-4 flex h-72 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No trend data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={290}>
              <AreaChart data={inflowTrendChart} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="billingGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.billing} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={CHART_COLORS.billing} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="commerceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.commerce} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.commerce} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} />
                <Tooltip content={<TooltipCard />} />
                <Area type="monotone" dataKey="billing" name="Billing" stroke={CHART_COLORS.billing} fill="url(#billingGradient)" strokeWidth={2} />
                <Area type="monotone" dataKey="commerce" name="Commerce" stroke={CHART_COLORS.commerce} fill="url(#commerceGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm text-white">Source mix</h2>
          {loading ? (
            <div className="mt-4 h-72 rounded-2xl bg-zinc-900 animate-pulse" />
          ) : sourceMixChart.length === 0 ? (
            <div className="mt-4 flex h-72 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
              No source data
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={sourceMixChart} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={3} strokeWidth={0}>
                    {sourceMixChart.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {sourceMixChart.map((entry) => (
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
      </div>

      <div className="card p-5">
        <h2 className="text-sm text-white">Revenue by currency and source</h2>
        {loading ? (
          <div className="mt-4 h-72 rounded-2xl bg-zinc-900 animate-pulse" />
        ) : currencyComparisonChart.length === 0 ? (
          <div className="mt-4 flex h-72 items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-xs text-zinc-600">
            No currency revenue data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={currencyComparisonChart} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="currency" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} />
              <Tooltip content={<TooltipCard />} />
              <Bar dataKey="billing" name="Billing" fill={CHART_COLORS.billing} radius={[4, 4, 0, 0]} />
              <Bar dataKey="commerce" name="Commerce" fill={CHART_COLORS.commerce} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm text-white">Recent billing</h2>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {billingRecent.slice(0, 10).map((item) => (
              <div key={item.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{item.organization.name}</p>
                    <p className="text-xs text-zinc-500">{item.reference}</p>
                  </div>
                  <p className="text-sm text-white">{formatMoney(item.amountMinor)} {item.currency}</p>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {!loading && billingRecent.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-600">No billing transactions found.</div>
            ) : null}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm text-white">Recent commerce payments</h2>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {commerceRecent.slice(0, 10).map((item) => (
              <div key={item.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{item.organization.name}</p>
                    <p className="text-xs text-zinc-500">{item.reference} · Order {item.order.id.slice(-6)}</p>
                  </div>
                  <p className="text-sm text-white">{formatMoney(item.amountMinor)} {item.currency}</p>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {!loading && commerceRecent.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-600">No commerce payments found.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}