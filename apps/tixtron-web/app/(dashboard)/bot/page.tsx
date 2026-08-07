'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Users, MessageSquareText, BadgeCheck, Clock, ArrowUpRight, Megaphone } from 'lucide-react';
import { botsApi, communitiesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import TelegramBotCard, { CommandBot } from './telegram-bot-card';
import CommunityCard, { Community } from './community-card';

interface BotStats {
  totalCommands: number;
  uniqueUsers: number;
  subscriberCount: number;
  lastMessageAt: string | null;
  commandBreakdown: Array<{ command: string; count: number }>;
  myTicketsHitRate: { found: number; notFound: number; invalidEmail: number };
  activityOverTime: Array<{ date: string; count: number }>;
}

const COMMAND_LABEL: Record<string, string> = {
  start: '/start',
  events: '/events',
  mytickets: '/mytickets',
  subscribe: '/subscribe',
  unsubscribe: '/unsubscribe',
  help: '/help',
  unknown: 'Unrecognized',
};

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

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function BotPage() {
  const { activeOrgId } = useAuthStore();
  const { theme } = useTheme();
  const axisColor = theme === 'light' ? '#9CA1A8' : '#687177';
  const cursorColor = theme === 'light' ? '#9CA1A8' : '#33383C';
  const [bot, setBot] = useState<CommandBot | null>(null);
  const [stats, setStats] = useState<BotStats | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const res = await botsApi.list(activeOrgId);
      const found = (res.data as CommandBot[]).find((b) => b.botType === 'COMMAND') ?? null;
      setBot(found);
      if (found) {
        const statsRes = await botsApi.stats(activeOrgId, found.id);
        setStats(statsRes.data);
      } else {
        setStats(null);
      }
      const communityRes = await communitiesApi.get(activeOrgId);
      setCommunity(communityRes.data ?? null);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [activeOrgId]);
  useEffect(() => { void load(); }, [load]);

  const chartData = (stats?.activityOverTime ?? []).map((b) => ({
    label: new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    count: b.count,
  }));

  const hitRate = stats?.myTicketsHitRate;
  const hitTotal = (hitRate?.found ?? 0) + (hitRate?.notFound ?? 0);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Bot</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Your Telegram ticketing bot and how customers are using it.</p>
      </div>

      {loading ? (
        <div className="h-40 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      ) : (
        <>
          <TelegramBotCard orgId={activeOrgId ?? undefined} bot={bot} onChange={load} />
          <CommunityCard orgId={activeOrgId ?? undefined} bot={bot} community={community} onChange={load} />
        </>
      )}

      {bot && stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
              <div className="w-8 h-8 rounded-lg border flex items-center justify-center mb-3 text-brand-400 bg-brand-600/[0.14] border-brand-600/20">
                <Users className="w-4 h-4" />
              </div>
              <p className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight tabular-nums">{stats.uniqueUsers.toLocaleString()}</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5">Unique users reached</p>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
              <div className="w-8 h-8 rounded-lg border flex items-center justify-center mb-3 text-zinc-600 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-800/60 border-zinc-300/40 dark:border-zinc-700/40">
                <Megaphone className="w-4 h-4" />
              </div>
              <p className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight tabular-nums">{stats.subscriberCount.toLocaleString()}</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5">Marketing subscribers</p>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
              <div className="w-8 h-8 rounded-lg border flex items-center justify-center mb-3 text-zinc-600 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-800/60 border-zinc-300/40 dark:border-zinc-700/40">
                <MessageSquareText className="w-4 h-4" />
              </div>
              <p className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight tabular-nums">{stats.totalCommands.toLocaleString()}</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5">Commands handled</p>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
              <div className="w-8 h-8 rounded-lg border flex items-center justify-center mb-3 text-zinc-600 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-800/60 border-zinc-300/40 dark:border-zinc-700/40">
                <Clock className="w-4 h-4" />
              </div>
              <p className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">{timeAgo(stats.lastMessageAt)}</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5">Last activity</p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Commands — last 30 days</p>
              {stats.subscriberCount > 0 && (
                <Link href="/marketing" className="text-[11px] text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1">
                  Message subscribers <ArrowUpRight className="w-3 h-3" />
                </Link>
              )}
            </div>
            <ResponsiveContainer width="100%" height={170}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="botActivityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF6A00" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#FF6A00" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} interval={5} />
                <YAxis allowDecimals={false} tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip content={<ChartTooltip suffix=" commands" />} cursor={{ stroke: cursorColor }} />
                <Area type="monotone" dataKey="count" stroke="#FF6A00" strokeWidth={2.25} fill="url(#botActivityGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">Command breakdown</p>
              {stats.commandBreakdown.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-600 py-4 text-center">No commands yet</p>
              ) : (
                <div className="space-y-2.5">
                  {stats.commandBreakdown.map((c) => {
                    const max = stats.commandBreakdown[0]?.count || 1;
                    return (
                      <div key={c.command}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-zinc-700 dark:text-zinc-300">{COMMAND_LABEL[c.command] ?? c.command}</span>
                          <span className="text-zinc-500 dark:text-zinc-500">{c.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                          <div className="h-full bg-brand-600" style={{ width: `${(c.count / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">/mytickets lookups</p>
              {hitTotal === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-600 py-4 text-center">No lookups yet</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-zinc-700 dark:text-zinc-300">Found a ticket</span>
                        <span className="text-zinc-500 dark:text-zinc-500">{hitRate!.found}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${(hitRate!.found / hitTotal) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4 text-zinc-400 dark:text-zinc-600 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-zinc-700 dark:text-zinc-300">No ticket found</span>
                        <span className="text-zinc-500 dark:text-zinc-500">{hitRate!.notFound}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-zinc-400 dark:bg-zinc-600" style={{ width: `${(hitRate!.notFound / hitTotal) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                  {hitRate!.invalidEmail > 0 && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-600">Plus {hitRate!.invalidEmail} attempt{hitRate!.invalidEmail === 1 ? '' : 's'} with no valid email given.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
