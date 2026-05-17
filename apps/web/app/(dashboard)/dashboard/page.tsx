'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Bot, Users, AlertCircle, BookOpen, ArrowRight } from 'lucide-react';
import { orgsApi, conversationsApi, botsApi } from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie,
} from 'recharts';

interface Org { id: string; name: string; slug: string; }

interface Conv {
  id: string;
  status: string;
  customerName: string;
  lastMessageAt: string;
  createdAt: string;
}

function getDayLabel(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function buildVolumeData(convs: Conv[]) {
  const buckets: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    buckets[getDayLabel(i)] = 0;
  }
  convs.forEach((c) => {
    const created = new Date(c.createdAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - created.getTime()) / 86400000);
    if (diffDays <= 6) {
      const label = getDayLabel(diffDays);
      buckets[label] = (buckets[label] ?? 0) + 1;
    }
  });
  return Object.entries(buckets).map(([day, count]) => ({ day, count }));
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: '#e4e4e7',
  PENDING: '#71717a',
  RESOLVED: '#3f3f46',
  ESCALATED: '#f87171',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300">
        {payload[0].value} conversations
      </div>
    );
  }
  return null;
};

export default function DashboardPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [stats, setStats] = useState({ total: 0, open: 0, escalated: 0, resolved: 0, bots: 0, members: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    orgsApi.list().then(async (res) => {
      const orgs: Org[] = res.data;
      if (!orgs.length) return;
      const first = orgs[0];
      setOrg(first);

      const [convRes, botRes, orgRes] = await Promise.allSettled([
        conversationsApi.list(first.id),
        botsApi.list(first.id),
        orgsApi.get(first.slug),
      ]);

      const conversations: Conv[] = convRes.status === 'fulfilled' ? convRes.value.data : [];
      const bots = botRes.status === 'fulfilled' ? botRes.value.data : [];
      const orgData = orgRes.status === 'fulfilled' ? orgRes.value.data : null;

      setConvs(conversations);
      setStats({
        total: conversations.length,
        open: conversations.filter((c) => c.status === 'OPEN').length,
        escalated: conversations.filter((c) => c.status === 'ESCALATED').length,
        resolved: conversations.filter((c) => c.status === 'RESOLVED').length,
        bots: bots.length,
        members: orgData?.members?.length ?? 0,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const volumeData = buildVolumeData(convs);

  const statusData = [
    { name: 'Open', value: stats.open, color: STATUS_COLORS.OPEN },
    { name: 'Resolved', value: stats.resolved, color: STATUS_COLORS.RESOLVED },
    { name: 'Escalated', value: stats.escalated, color: STATUS_COLORS.ESCALATED },
    { name: 'Pending', value: stats.total - stats.open - stats.resolved - stats.escalated, color: STATUS_COLORS.PENDING },
  ].filter((d) => d.value > 0);

  const recent = [...convs]
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .slice(0, 5);

  const statCards = [
    { label: 'Total conversations', value: stats.total, icon: MessageSquare },
    { label: 'Open', value: stats.open, icon: AlertCircle },
    { label: 'Active bots', value: stats.bots, icon: Bot },
    { label: 'Team members', value: stats.members, icon: Users },
  ];

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          {loading
            ? <span className="inline-block w-40 h-7 bg-zinc-900 animate-pulse rounded-lg" />
            : (org?.name ?? 'Dashboard')}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">Overview of your workspace activity.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statCards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-zinc-500 font-normal">{label}</p>
              <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-zinc-400" />
              </div>
            </div>
            {loading
              ? <div className="w-10 h-7 bg-zinc-800 animate-pulse rounded" />
              : <p className="font-brand font-semibold text-3xl text-white tracking-tight">{value}</p>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Volume bar chart */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-normal text-white">Conversation volume</h2>
              <p className="text-xs text-zinc-600 font-light mt-0.5">Last 7 days</p>
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
                      fill={entry.count > 0 ? '#e4e4e7' : '#27272a'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status donut */}
        <div className="card p-6">
          <div className="mb-6">
            <h2 className="text-sm font-normal text-white">Status breakdown</h2>
            <p className="text-xs text-zinc-600 font-light mt-0.5">All time</p>
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

      {/* Bottom row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Recent conversations */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-normal text-white">Recent conversations</h2>
            <a href="/inbox" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
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
                  href="/inbox"
                  className="flex items-center justify-between py-2.5 px-1 rounded-lg hover:bg-zinc-900/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                      <span className="text-xs text-zinc-400">{c.customerName?.[0]?.toUpperCase() ?? '?'}</span>
                    </div>
                    <div>
                      <p className="text-sm text-zinc-300 font-light group-hover:text-white transition-colors">{c.customerName}</p>
                      <p className="text-xs text-zinc-600">
                        {new Date(c.lastMessageAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-normal ${
                    c.status === 'OPEN' ? 'bg-zinc-800 text-zinc-300' :
                    c.status === 'ESCALATED' ? 'bg-red-500/15 text-red-400' :
                    c.status === 'RESOLVED' ? 'bg-zinc-900 text-zinc-600' :
                    'bg-zinc-800 text-zinc-500'
                  }`}>
                    {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="card p-6">
          <h2 className="text-sm font-normal text-white mb-5">Quick actions</h2>
          <div className="space-y-2">
            {[
              { href: '/bots', icon: Bot, label: 'Add a bot', sub: 'Connect Telegram' },
              { href: '/inbox', icon: MessageSquare, label: 'Open inbox', sub: 'View messages' },
              { href: '/knowledge', icon: BookOpen, label: 'Add knowledge', sub: 'Train your AI' },
            ].map(({ href, icon: Icon, label, sub }) => (
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
