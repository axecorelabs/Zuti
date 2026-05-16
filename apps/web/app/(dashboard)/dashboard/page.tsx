'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Bot, Users, TrendingUp } from 'lucide-react';
import { orgsApi, conversationsApi, botsApi } from '@/lib/api';

interface Org {
  id: string;
  name: string;
  slug: string;
}

interface StatCard {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}

export default function DashboardPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [stats, setStats] = useState({ conversations: 0, bots: 0, members: 0, open: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    orgsApi
      .list()
      .then(async (res) => {
        const orgs: Org[] = res.data;
        if (orgs.length === 0) return;
        const first = orgs[0];
        setOrg(first);

        const [convRes, botRes, orgRes] = await Promise.allSettled([
          conversationsApi.list(first.id),
          botsApi.list(first.id),
          orgsApi.get(first.slug),
        ]);

        const convs = convRes.status === 'fulfilled' ? convRes.value.data : [];
        const bots = botRes.status === 'fulfilled' ? botRes.value.data : [];
        const orgData = orgRes.status === 'fulfilled' ? orgRes.value.data : null;

        setStats({
          conversations: convs.length,
          bots: bots.length,
          members: orgData?.members?.length ?? 0,
          open: convs.filter((c: { status: string }) => c.status === 'OPEN').length,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const cards: StatCard[] = [
    {
      label: 'Total conversations',
      value: stats.conversations,
      icon: MessageSquare,
      accent: 'text-accent-blue',
    },
    {
      label: 'Open now',
      value: stats.open,
      sub: 'Awaiting response',
      icon: TrendingUp,
      accent: 'text-accent-pink',
    },
    {
      label: 'Active bots',
      value: stats.bots,
      icon: Bot,
    },
    {
      label: 'Team members',
      value: stats.members,
      icon: Users,
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-10">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          {loading ? (
            <span className="inline-block w-40 h-7 bg-zinc-900 animate-pulse rounded-lg" />
          ) : (
            org?.name ?? 'Dashboard'
          )}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Here's what's happening with your workspace.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {cards.map(({ label, value, sub, icon: Icon, accent }) => (
          <div key={label} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs text-zinc-600 font-normal">{label}</p>
              <Icon className={`w-4 h-4 ${accent ?? 'text-zinc-700'}`} />
            </div>
            {loading ? (
              <div className="w-12 h-8 bg-zinc-800 animate-pulse rounded" />
            ) : (
              <p className="font-brand font-semibold text-3xl text-white tracking-tight">
                {value}
              </p>
            )}
            {sub && <p className="mt-1 text-xs text-zinc-600 font-light">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="card p-6">
        <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">
          Quick start
        </h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <a
            href="/bots"
            className="group flex items-center gap-3 p-4 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-900 transition-all"
          >
            <Bot className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            <div>
              <p className="text-sm text-zinc-300 font-normal group-hover:text-white transition-colors">
                Create a bot
              </p>
              <p className="text-xs text-zinc-600 font-light">Connect Telegram</p>
            </div>
          </a>
          <a
            href="/inbox"
            className="group flex items-center gap-3 p-4 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-900 transition-all"
          >
            <MessageSquare className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            <div>
              <p className="text-sm text-zinc-300 font-normal group-hover:text-white transition-colors">
                Open inbox
              </p>
              <p className="text-xs text-zinc-600 font-light">View conversations</p>
            </div>
          </a>
          <a
            href="/knowledge"
            className="group flex items-center gap-3 p-4 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-900 transition-all"
          >
            <MessageSquare className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            <div>
              <p className="text-sm text-zinc-300 font-normal group-hover:text-white transition-colors">
                Add knowledge
              </p>
              <p className="text-xs text-zinc-600 font-light">Train your AI</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
