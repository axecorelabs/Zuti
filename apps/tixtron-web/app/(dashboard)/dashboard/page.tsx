'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { CalendarDays, MapPin, ArrowUpRight, ArrowDownRight, Ticket, Wallet, Users } from 'lucide-react';
import { registrationsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

interface EventArtwork { bannerUrl: string | null; flierUrl: string | null }
interface NextEvent extends EventArtwork {
  id: string; name: string; eventDate: string | null; eventEndDate: string | null; eventDateHasTime: boolean;
  venue: string | null; capacity: number | null; ticketsSold: number;
}
interface Trend { changePct: number | null; last30: number; prev30: number; sparkline: number[] }
interface OverviewData {
  totalEvents: number;
  activeEvents: number;
  totalTicketsSold: number;
  totalRegistrants: number;
  revenueByCurrency: Record<string, number>;
  statusBreakdown: Record<string, number>;
  registrationsOverTime: Array<{ date: string; tickets: number }>;
  upcomingEvents: Array<{ id: string; name: string; eventDate: string | null; eventEndDate: string | null; eventDateHasTime: boolean } & EventArtwork & { venue: string | null }>;
  topEvents: Array<{ id: string; name: string; ticketsSold: number } & EventArtwork>;
  nextEvent: NextEvent | null;
  trends: { tickets: Trend; revenue: Trend; events: Trend; registrants: Trend };
}

function ChartTooltip({ active, payload, label, suffix }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg">
      {label ? <p className="text-zinc-500 dark:text-zinc-500 mb-0.5">{label}</p> : null}
      <p className="text-zinc-900 dark:text-white font-medium">{p.name ? `${p.name}: ` : ''}{p.value}{suffix ?? ''}</p>
    </div>
  );
}

function formatEventDate(ev: { eventDate: string | null; eventEndDate: string | null; eventDateHasTime: boolean }): string {
  if (!ev.eventDate) return '';
  const start = new Date(ev.eventDate);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const startStr = start.toLocaleDateString('en-GB', opts);
  const end = ev.eventEndDate ? new Date(ev.eventEndDate) : null;
  if (!end || end.toDateString() === start.toDateString()) {
    return ev.eventDateHasTime ? `${startStr}, ${start.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}` : startStr;
  }
  return `${startStr} – ${end.toLocaleDateString('en-GB', opts)}`;
}

function daysUntilLabel(eventDate: string | null): string {
  if (!eventDate) return '';
  const ms = new Date(eventDate).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const AVATAR_GRADIENTS = [
  ['#FF6A00', '#B34B00'], ['#34D399', '#0F766E'], ['#8B5CF6', '#4C1D95'], ['#F5B94D', '#92400E'], ['#EC4899', '#831843'],
];
function gradientFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 76, h = 30, pad = 3;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => `${pad + i * step},${pad + (h - pad * 2) * (1 - (v - min) / range)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible shrink-0" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeltaLabel({ changePct }: { changePct: number | null }) {
  if (changePct === null) return <span className="text-[11.5px] font-medium text-zinc-400 dark:text-zinc-600">New this period</span>;
  if (changePct === 0) return <span className="text-[11.5px] font-medium text-zinc-500 dark:text-zinc-500">No change</span>;
  const positive = changePct > 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold whitespace-nowrap ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      <Icon className="w-3 h-3 shrink-0" />
      {positive ? '+' : ''}{changePct.toFixed(1)}%
    </span>
  );
}

function StatCard({ label, value, icon: Icon, trend, accent = 'brand' }: {
  label: string; value: string; icon: typeof Ticket; trend: Trend; accent?: 'brand' | 'emerald';
}) {
  const badgeClass = accent === 'emerald'
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]'
    : 'text-brand-400 border-brand-500/30 bg-brand-600/[0.08]';
  const sparkColor = accent === 'emerald' ? '#34D399' : '#FF6A00';
  return (
    <div className="rounded-[20px] border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-500 truncate">{label}</span>
        <div className={`flex items-center justify-center w-7 h-7 rounded-[9px] border shrink-0 ${badgeClass}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <p className="mt-2 text-[21px] leading-none font-semibold tracking-tight text-zinc-900 dark:text-white tabular-nums truncate">{value}</p>
      <div className="mt-auto pt-2 flex items-end justify-between gap-1.5">
        <DeltaLabel changePct={trend.changePct} />
        <Sparkline values={trend.sparkline} color={sparkColor} />
      </div>
    </div>
  );
}

function Thumb({ id, name, artwork }: { id: string; name: string; artwork: EventArtwork }) {
  const image = artwork.bannerUrl ?? artwork.flierUrl;
  if (image) {
    return <div className="w-10 h-10 rounded-[10px] shrink-0 border border-zinc-200 dark:border-zinc-800 bg-cover bg-center" style={{ backgroundImage: `url(${image})` }} />;
  }
  return (
    <div
      className="w-10 h-10 rounded-[10px] shrink-0 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-900 dark:text-white text-sm font-semibold"
      style={{ backgroundImage: gradientFor(id) }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function OverviewPage() {
  const { activeOrgId } = useAuthStore();
  const { theme } = useTheme();
  const axisColor = theme === 'light' ? '#9CA1A8' : '#687177';
  const cursorColor = theme === 'light' ? '#9CA1A8' : '#33383C';
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrgId) return;
    setLoading(true);
    registrationsApi.overview(activeOrgId)
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [activeOrgId]);

  const chartData = (data?.registrationsOverTime ?? []).map((b) => ({
    label: new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    tickets: b.tickets,
  }));

  const revenueEntries = Object.entries(data?.revenueByCurrency ?? {});
  const revenueLabel = revenueEntries.length
    ? revenueEntries.map(([cur, minor]) => `${cur} ${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(' · ')
    : '—';

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        <div className="h-8 w-40 rounded bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3">
          <div className="h-[280px] rounded-[20px] bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
          <div className="grid grid-cols-2 grid-rows-2 gap-3">
            <div className="rounded-[20px] bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
            <div className="rounded-[20px] bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
            <div className="rounded-[20px] bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
            <div className="rounded-[20px] bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
          </div>
        </div>
        <div className="h-40 rounded-[20px] bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      </div>
    );
  }

  if (!data || data.totalEvents === 0) {
    return (
      <div className="p-4 md:p-6">
        <div className="mb-6">
          <span className="block text-xs font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-wider mb-0.5">{greeting()}</span>
          <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Your events</h1>
        </div>
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center">
          <CalendarDays className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No events yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1 mb-4">Create your first event to start seeing data here.</p>
          <Link href="/events" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium">
            Go to Events <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  const next = data.nextEvent;
  const nextImage = next ? (next.bannerUrl ?? next.flierUrl) : null;
  const soldPct = next?.capacity ? Math.min(100, Math.round((next.ticketsSold / next.capacity) * 100)) : null;
  // Real light/dark photo variants (verified — not just a recolor) so the gradient overlay never
  // has to fight the photo's own base tone. Text inside this card stays fixed light-on-dark-overlay
  // regardless of site theme — the overlay guarantees a dark backdrop at the bottom either way.
  const heroBackgroundImage = theme === 'light'
    ? 'linear-gradient(180deg, rgba(15,17,21,0.05) 0%, rgba(15,17,21,0.28) 45%, rgba(15,17,21,0.90) 100%), url(https://res.cloudinary.com/dhmnkd7hi/image/upload/v1785762352/IMG_4625_jgk175.jpg)'
    : 'linear-gradient(180deg, rgba(15,17,21,0.02) 0%, rgba(15,17,21,0.1) 55%, rgba(15,17,21,0.92) 100%), url(https://res.cloudinary.com/dhmnkd7hi/image/upload/v1785762355/IMG_4628_dh1n0t.jpg)';

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <span className="block text-xs font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-wider mb-0.5">{greeting()}</span>
        <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Your events</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3 items-stretch">
        {/* Next up hero */}
        {next ? (
          <Link
            href="/events"
            className="relative rounded-[20px] overflow-hidden border border-zinc-200 dark:border-zinc-800 min-h-[280px] flex flex-col justify-end p-5 group"
            style={{
              backgroundImage: heroBackgroundImage,
              backgroundSize: 'cover',
              backgroundPosition: 'center top',
            }}
          >
            <span className="relative self-start inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-400 bg-zinc-950/55 border border-brand-600/35 px-2.5 py-1 rounded-full mb-auto">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500" style={{ boxShadow: '0 0 0 3px rgba(255,106,0,0.25)' }} />
              Next up · {daysUntilLabel(next.eventDate)}
            </span>
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-16 h-16 rounded-2xl shrink-0 border border-white/10 bg-cover bg-center"
                  style={{ backgroundImage: nextImage ? `url(${nextImage})` : gradientFor(next.id) }}
                />
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-tight text-white group-hover:underline decoration-brand-500/50 underline-offset-4 truncate">{next.name}</h2>
                  <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-zinc-300 mt-1">
                    <span className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-zinc-500" /> {formatEventDate(next)}</span>
                    {next.venue && <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-zinc-500" /> {next.venue}</span>}
                  </div>
                </div>
              </div>
              {next.capacity ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600" style={{ width: `${soldPct}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-white tabular-nums whitespace-nowrap">{next.ticketsSold.toLocaleString()} / {next.capacity.toLocaleString()}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1.5">{soldPct}% sold</p>
                </>
              ) : (
                <p className="text-xs font-semibold text-white tabular-nums flex items-center gap-1.5">
                  <Ticket className="w-3.5 h-3.5 text-brand-400" /> {next.ticketsSold.toLocaleString()} tickets sold
                </p>
              )}
            </div>
          </Link>
        ) : (
          <div className="rounded-[20px] border border-dashed border-zinc-200 dark:border-zinc-800 min-h-[280px] flex flex-col items-center justify-center text-center p-6">
            <CalendarDays className="w-7 h-7 text-zinc-300 dark:text-zinc-700 mb-2" />
            <p className="text-sm text-zinc-500 dark:text-zinc-500">No upcoming events scheduled</p>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
          <StatCard label="Tickets sold" value={data.totalTicketsSold.toLocaleString()} icon={Ticket} trend={data.trends.tickets} accent="brand" />
          <StatCard label="Revenue" value={revenueLabel} icon={Wallet} trend={data.trends.revenue} accent="emerald" />
          <StatCard label="Total events" value={data.totalEvents.toLocaleString()} icon={CalendarDays} trend={data.trends.events} accent="brand" />
          <StatCard label="Total registrants" value={data.totalRegistrants.toLocaleString()} icon={Users} trend={data.trends.registrants} accent="emerald" />
        </div>
      </div>

      {/* Momentum chart */}
      <div className="rounded-[20px] border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Momentum — last 30 days</p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-600 tabular-nums">{data.totalTicketsSold.toLocaleString()} tickets</p>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="overviewMomentumGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF6A00" stopOpacity={0.32} />
                <stop offset="100%" stopColor="#FF6A00" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} interval={5} />
            <YAxis allowDecimals={false} tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip content={<ChartTooltip suffix=" tickets" />} cursor={{ stroke: cursorColor }} />
            <Area type="monotone" dataKey="tickets" stroke="#FF6A00" strokeWidth={2.25} fill="url(#overviewMomentumGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-[20px] border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Top sellers</p>
            <Link href="/events" className="text-[11px] text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1">View all <ArrowUpRight className="w-3 h-3" /></Link>
          </div>
          {data.topEvents.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 py-4 text-center">No ticket sales yet</p>
          ) : (
            <div className="space-y-1">
              {data.topEvents.map((ev, i) => {
                const max = data.topEvents[0]?.ticketsSold || 1;
                return (
                  <div key={ev.id} className="flex items-center gap-3 py-2 border-b border-zinc-200/40 dark:border-zinc-800/40 last:border-0">
                    <Thumb id={ev.id} name={ev.name} artwork={ev} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-zinc-800 dark:text-zinc-200 truncate">{i + 1}. {ev.name}</p>
                      <div className="h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mt-1.5 max-w-[140px]">
                        <div className="h-full bg-brand-600" style={{ width: `${(ev.ticketsSold / max) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums shrink-0">{ev.ticketsSold.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-[20px] border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Coming up</p>
            <Link href="/events" className="text-[11px] text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1">View all <ArrowUpRight className="w-3 h-3" /></Link>
          </div>
          {data.upcomingEvents.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 py-4 text-center">No upcoming events scheduled</p>
          ) : (
            <div className="space-y-1">
              {data.upcomingEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 py-2 border-b border-zinc-200/40 dark:border-zinc-800/40 last:border-0">
                  <Thumb id={ev.id} name={ev.name} artwork={ev} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-zinc-800 dark:text-zinc-200 truncate">{ev.name}</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-500 truncate">{formatEventDate(ev)}</p>
                  </div>
                  <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0 whitespace-nowrap">
                    {daysUntilLabel(ev.eventDate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
