'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Bot, Users, AlertCircle, BookOpen, ArrowRight } from 'lucide-react';
import { orgsApi, conversationsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie,
} from 'recharts';

interface Org { id: string; name: string; slug: string; }

interface OrgSummary extends Org {
  role: MemberRole;
  memberCount?: number;
  botCount?: number;
}

type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

interface Conv {
  id: string;
  status: string;
  customerName: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

interface OverviewData {
  totals: {
    total: number;
    open: number;
    escalated: number;
    resolved: number;
    pending: number;
  };
  volumeByDay: Array<{ date: string; count: number }>;
  recentConversations: Conv[];
}

function toWeekdayLabel(isoDate: string) {
  return new Date(isoDate).toLocaleDateString('en-US', { weekday: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: '#3b82f6',
  PENDING: '#71717a',
  RESOLVED: '#3f3f46',
  ESCALATED: '#f87171',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    return (
      <div className="overview-tooltip bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300">
        {payload[0].value} conversations
      </div>
    );
  }
  return null;
};

export default function DashboardPage() {
  const { getRoleForOrg, activeOrgId } = useAuthStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [stats, setStats] = useState({ total: 0, open: 0, escalated: 0, resolved: 0, bots: 0, members: 0 });
  const [loading, setLoading] = useState(true);
  const withOrg = (path: string) => (activeOrgId ? `${path}?org=${activeOrgId}` : path);

  useEffect(() => {
    orgsApi.listSummary().then(async (res) => {
      const orgs = res.data as OrgSummary[];
      if (!orgs.length) return;
      const preferred = activeOrgId
        ? (orgs.find((currentOrg) => currentOrg.id === activeOrgId) ?? orgs[0])
        : orgs[0];
      setOrg(preferred);
      const role = (preferred.role ?? getRoleForOrg(preferred.id) ?? null) as MemberRole | null;
      setMyRole(role);

      const overviewRes = await conversationsApi.overview(preferred.id).catch(() => null);
      const overviewData = (overviewRes?.data as OverviewData | undefined) ?? null;
      setOverview(overviewData);

      setStats({
        total: overviewData?.totals.total ?? 0,
        open: overviewData?.totals.open ?? 0,
        escalated: overviewData?.totals.escalated ?? 0,
        resolved: overviewData?.totals.resolved ?? 0,
        bots: role === 'AGENT' ? 0 : (preferred.botCount ?? 0),
        members: preferred.memberCount ?? 0,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [activeOrgId, getRoleForOrg]);

  const volumeData = (overview?.volumeByDay ?? []).map((point) => ({
    day: toWeekdayLabel(point.date),
    count: point.count,
  }));

  const statusData = [
    { name: 'Open', value: stats.open, color: STATUS_COLORS.OPEN },
    { name: 'Resolved', value: stats.resolved, color: STATUS_COLORS.RESOLVED },
    { name: 'Escalated', value: stats.escalated, color: STATUS_COLORS.ESCALATED },
    { name: 'Pending', value: stats.total - stats.open - stats.resolved - stats.escalated, color: STATUS_COLORS.PENDING },
  ].filter((d) => d.value > 0);

  const recent = overview?.recentConversations ?? [];

  const statCards = myRole === 'AGENT'
    ? [
        { label: 'Visible conversations', value: stats.total, icon: MessageSquare, accent: 'bg-blue-600/15 border-blue-600/20 text-blue-400' },
        { label: 'Open', value: stats.open, icon: AlertCircle, accent: 'bg-orange-500/15 border-orange-500/20 text-orange-400' },
        { label: 'Escalated', value: stats.escalated, icon: Users, accent: 'bg-red-500/15 border-red-500/20 text-red-400' },
        { label: 'Resolved', value: stats.resolved, icon: Bot, accent: 'bg-emerald-500/15 border-emerald-500/20 text-emerald-400' },
      ]
    : [
        { label: 'Total conversations', value: stats.total, icon: MessageSquare, accent: 'bg-blue-600/15 border-blue-600/20 text-blue-400' },
        { label: 'Open', value: stats.open, icon: AlertCircle, accent: 'bg-orange-500/15 border-orange-500/20 text-orange-400' },
        { label: 'Active bots', value: stats.bots, icon: Bot, accent: 'bg-zinc-800 border-zinc-700 text-zinc-400' },
        { label: 'Team members', value: stats.members, icon: Users, accent: 'bg-zinc-800 border-zinc-700 text-zinc-400' },
      ];

  const quickActions = myRole === 'AGENT'
    ? [
        { href: withOrg('/inbox'), icon: MessageSquare, label: 'Open inbox', sub: 'Handle visible conversations' },
        { href: withOrg('/team'), icon: Users, label: 'View team', sub: 'See your workspace roster' },
        { href: withOrg('/activity'), icon: AlertCircle, label: 'Your activity', sub: 'Review your recent actions' },
      ]
    : [
        { href: withOrg('/bots'), icon: Bot, label: 'Add AI agent', sub: 'Connect Telegram' },
        { href: withOrg('/inbox'), icon: MessageSquare, label: 'Open inbox', sub: 'View messages' },
        { href: withOrg('/knowledge'), icon: BookOpen, label: 'Add knowledge', sub: 'Train your AI' },
      ];

  return (
    <div className="overview-page p-4 md:p-8">
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          {loading
            ? <span className="inline-block w-40 h-7 bg-zinc-900 animate-pulse rounded-lg" />
            : (org?.name ?? 'Dashboard')}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          {myRole === 'AGENT'
            ? 'A personal overview of the conversations and activity visible to you.'
            : 'Overview of your workspace activity.'}
        </p>
      </div>

      <div className="overview-stat-grid grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statCards.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="overview-stat-card card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="overview-stat-label text-xs text-zinc-500 font-normal">{label}</p>
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${accent}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
            </div>
            {loading
              ? <div className="w-10 h-7 bg-zinc-800 animate-pulse rounded" />
              : <p className="overview-stat-value font-brand font-semibold text-3xl text-white tracking-tight">{value}</p>}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-normal text-white">Conversation volume</h2>
              <p className="text-xs text-zinc-600 font-light mt-0.5">
                {myRole === 'AGENT' ? 'Your visible conversations in the last 7 days' : 'Last 7 days'}
              </p>
            </div>
          </div>
          {loading ? (
            <div className="h-40 bg-zinc-900 animate-pulse rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={volumeData} barSize={24}>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#52525b', fontSize: 11 }}
                />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {volumeData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.count > 0 ? '#3b82f6' : '#27272a'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-6">
          <div className="mb-6">
            <h2 className="text-sm font-normal text-white">Status breakdown</h2>
            <p className="text-xs text-zinc-600 font-light mt-0.5">
              {myRole === 'AGENT' ? 'Only conversations visible to you' : 'All time'}
            </p>
          </div>
          {loading ? (
            <div className="h-40 bg-zinc-900 animate-pulse rounded-xl" />
          ) : stats.total === 0 ? (
            <div className="h-40 flex items-center justify-center text-xs text-zinc-600">No data yet</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={36}
                    outerRadius={56}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-3">
                {statusData.map((s) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                      <span className="text-xs text-zinc-500 font-light">{s.name}</span>
                    </div>
                    <span className="text-xs text-zinc-300 font-normal">{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-normal text-white">
              {myRole === 'AGENT' ? 'Your recent conversations' : 'Recent conversations'}
            </h2>
            <a href={withOrg('/inbox')} className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 transition-colors">
              View all <ArrowRight className="w-3 h-3" />
            </a>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 bg-zinc-900 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="text-xs text-zinc-600 py-6 text-center">No conversations yet.</p>
          ) : (
            <div className="space-y-1">
              {recent.map((c) => (
                <a
                  key={c.id}
                  href={withOrg('/inbox')}
                  className="flex items-center justify-between py-2.5 px-1 rounded-lg hover:bg-zinc-900/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                      <span className="text-xs text-zinc-400">{c.customerName?.[0]?.toUpperCase() ?? '?'}</span>
                    </div>
                    <div>
                      <p className="text-sm text-zinc-300 font-light group-hover:text-white transition-colors">{c.customerName || 'Anonymous'}</p>
                      <p className="text-xs text-zinc-600">
                        {new Date(c.lastMessageAt ?? c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-normal ${
                    c.status === 'OPEN' ? 'bg-blue-500/15 text-blue-400' :
                    c.status === 'ESCALATED' ? 'bg-red-500/15 text-red-400' :
                    c.status === 'RESOLVED' ? 'bg-zinc-900 text-zinc-600' :
                    'bg-orange-500/15 text-orange-400'
                  }`}>
                    {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-sm font-normal text-white mb-5">Quick actions</h2>
          <div className="space-y-2">
            {quickActions.map(({ href, icon: Icon, label, sub }) => (
              <a
                key={href}
                href={href}
                className="group flex items-center gap-3 p-3 rounded-xl border border-zinc-800/60 hover:border-zinc-700 hover:bg-zinc-900/50 transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 group-hover:bg-zinc-700 transition-colors">
                  <Icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm text-zinc-300 font-light group-hover:text-white transition-colors">{label}</p>
                  <p className="text-xs text-zinc-600">{sub}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
