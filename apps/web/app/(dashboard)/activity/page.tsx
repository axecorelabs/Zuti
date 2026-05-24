'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { orgsApi, activityApi } from '@/lib/api';
import {
  Activity,
  UserPlus,
  UserMinus,
  ShieldCheck,
  MessageSquare,
  ArrowUpRight,
  Send,
  Search,
  Copy,
  ExternalLink,
} from 'lucide-react';

interface ActivityLog {
  id: string;
  orgId: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  AGENT_TOOK_OVER: 'took over a conversation',
  CONVERSATION_ESCALATED: 'escalated a conversation',
  CONVERSATION_ASSIGNED: 'assigned a conversation',
  CONVERSATION_RESOLVED: 'resolved a conversation',
  CSAT_RECORDED_POSITIVE: 'received positive CSAT',
  CSAT_RECORDED_NEGATIVE: 'received negative CSAT',
  MEMBER_JOINED: 'joined the workspace',
  MEMBER_REMOVED: 'was removed from the workspace',
  MEMBER_ROLE_CHANGED: 'had their role changed',
  INVITATION_SENT: 'sent an invitation',
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  AGENT_TOOK_OVER: MessageSquare,
  CONVERSATION_ESCALATED: ArrowUpRight,
  CONVERSATION_ASSIGNED: MessageSquare,
  CONVERSATION_RESOLVED: MessageSquare,
  CSAT_RECORDED_POSITIVE: MessageSquare,
  CSAT_RECORDED_NEGATIVE: MessageSquare,
  MEMBER_JOINED: UserPlus,
  MEMBER_REMOVED: UserMinus,
  MEMBER_ROLE_CHANGED: ShieldCheck,
  INVITATION_SENT: Send,
};

type ActivityCategory = 'ALL' | 'CONVERSATIONS' | 'ESCALATIONS' | 'ACCESS' | 'INVITES' | 'OTHER';
type TimeRange = '24H' | '7D' | '30D' | 'ALL';

const ACTION_CATEGORY: Record<string, ActivityCategory> = {
  AGENT_TOOK_OVER: 'CONVERSATIONS',
  CONVERSATION_ESCALATED: 'ESCALATIONS',
  CONVERSATION_ASSIGNED: 'CONVERSATIONS',
  CONVERSATION_RESOLVED: 'CONVERSATIONS',
  CSAT_RECORDED_POSITIVE: 'CONVERSATIONS',
  CSAT_RECORDED_NEGATIVE: 'CONVERSATIONS',
  MEMBER_JOINED: 'ACCESS',
  MEMBER_REMOVED: 'ACCESS',
  MEMBER_ROLE_CHANGED: 'ACCESS',
  INVITATION_SENT: 'INVITES',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function inSelectedRange(iso: string, range: TimeRange) {
  if (range === 'ALL') return true;
  const ageMs = Date.now() - new Date(iso).getTime();
  if (range === '24H') return ageMs <= 24 * 60 * 60 * 1000;
  if (range === '7D') return ageMs <= 7 * 24 * 60 * 60 * 1000;
  return ageMs <= 30 * 24 * 60 * 60 * 1000;
}

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function shortId(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function customerEventText(log: ActivityLog) {
  const shortTarget = shortId(log.targetId);
  switch (log.action) {
    case 'CONVERSATION_ESCALATED':
      return `${log.actorName} flagged a customer case for specialist help${shortTarget ? ` (${shortTarget})` : ''}.`;
    case 'CONVERSATION_RESOLVED':
      return `${log.actorName} resolved a customer case${shortTarget ? ` (${shortTarget})` : ''}.`;
    case 'CSAT_RECORDED_POSITIVE':
      return `Customer gave a positive satisfaction response${shortTarget ? ` (${shortTarget})` : ''}.`;
    case 'CSAT_RECORDED_NEGATIVE':
      return `Customer gave a negative satisfaction response${shortTarget ? ` (${shortTarget})` : ''}.`;
    case 'CONVERSATION_ASSIGNED':
      return `${log.actorName} assigned a customer case${shortTarget ? ` (${shortTarget})` : ''}.`;
    case 'AGENT_TOOK_OVER':
      return `${log.actorName} took over a customer case${shortTarget ? ` (${shortTarget})` : ''}.`;
    case 'MEMBER_ROLE_CHANGED':
      return `${log.actorName} changed team access permissions.`;
    case 'MEMBER_REMOVED':
      return `${log.actorName} removed a teammate from the workspace.`;
    case 'MEMBER_JOINED':
      return `${log.actorName} joined the workspace.`;
    case 'INVITATION_SENT':
      return `${log.actorName} invited a teammate to the workspace.`;
    default:
      return `${log.actorName} ${log.action.toLowerCase().replace(/_/g, ' ')}.`;
  }
}

function needsAttention(log: ActivityLog) {
  return log.action === 'CONVERSATION_ESCALATED' || log.action === 'MEMBER_REMOVED' || log.action === 'MEMBER_ROLE_CHANGED';
}

export default function ActivityPage() {
  const { getRoleForOrg } = useAuthStore();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ActivityCategory>('ALL');
  const [range, setRange] = useState<TimeRange>('7D');

  useEffect(() => {
    orgsApi.list().then((res) => {
      const list = res.data as { id: string; members?: { role: string }[] }[];
      if (!list.length) return;
      const first = list[0];
      const role = first.members?.[0]?.role ?? getRoleForOrg(first.id) ?? null;
      setMyRole(role);
      setOrgId(first.id);
    }).catch(() => setLoading(false));
  }, [getRoleForOrg]);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    activityApi
      .list(orgId)
      .then((res) => setLogs(res.data as ActivityLog[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();

    return [...logs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((log) => {
        if (!inSelectedRange(log.createdAt, range)) return false;

        const logCategory = ACTION_CATEGORY[log.action] ?? 'OTHER';
        if (category !== 'ALL' && logCategory !== category) return false;

        if (!q) return true;

        const label = ACTION_LABELS[log.action] ?? log.action.replace(/_/g, ' ').toLowerCase();
        const haystack = [
          log.actorName,
          log.action,
          label,
          log.targetType ?? '',
          log.targetId ?? '',
          JSON.stringify(log.metadata ?? {}),
        ].join(' ').toLowerCase();

        return haystack.includes(q);
      });
  }, [logs, query, category, range]);

  const groupedLogs = useMemo(() => {
    const groups = new Map<string, ActivityLog[]>();
    filteredLogs.forEach((log) => {
      const key = formatDayLabel(log.createdAt);
      const arr = groups.get(key) ?? [];
      arr.push(log);
      groups.set(key, arr);
    });
    return Array.from(groups.entries());
  }, [filteredLogs]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ActivityCategory, number> = {
      ALL: logs.length,
      CONVERSATIONS: 0,
      ESCALATIONS: 0,
      ACCESS: 0,
      INVITES: 0,
      OTHER: 0,
    };

    logs.forEach((log) => {
      const c = ACTION_CATEGORY[log.action] ?? 'OTHER';
      counts[c] += 1;
    });

    return counts;
  }, [logs]);

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore copy failures in non-secure contexts
    }
  };

  const visibleCounts = useMemo(() => {
    const counts: Record<ActivityCategory, number> = {
      ALL: filteredLogs.length,
      CONVERSATIONS: 0,
      ESCALATIONS: 0,
      ACCESS: 0,
      INVITES: 0,
      OTHER: 0,
    };

    filteredLogs.forEach((log) => {
      const c = ACTION_CATEGORY[log.action] ?? 'OTHER';
      counts[c] += 1;
    });

    return counts;
  }, [filteredLogs]);

  const newestVisibleAt = filteredLogs[0]?.createdAt;

  return (
    <div className="activity-page flex-1 overflow-y-auto bg-zinc-950 min-h-screen">
      <div className="w-full p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-600/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-blue-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Activity</h1>
            <p className="text-xs text-zinc-500 font-light">
              {myRole === 'AGENT' ? 'A clear feed of customer-impacting actions' : 'Customer-first command feed for support operations'}
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Focus on what needs action first, then drill into audit details only when needed.
            </p>
          </div>
        </div>

        <div className="activity-stat-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
          <div className="activity-stat-card rounded-xl border border-blue-600/25 bg-blue-600/5 p-3">
            <p className="activity-stat-label text-[11px] text-zinc-500">Visible events</p>
            <p className="activity-stat-value mt-1 text-xl font-semibold text-zinc-100">{visibleCounts.ALL}</p>
          </div>
          <div className="activity-stat-card rounded-xl border border-zinc-900 bg-zinc-950/40 p-3">
            <p className="activity-stat-label text-[11px] text-zinc-500">Conversations + Escalations</p>
            <p className="activity-stat-value mt-1 text-xl font-semibold text-zinc-100">{visibleCounts.CONVERSATIONS + visibleCounts.ESCALATIONS}</p>
          </div>
          <div className="activity-stat-card rounded-xl border border-zinc-900 bg-zinc-950/40 p-3">
            <p className="activity-stat-label text-[11px] text-zinc-500">Access + Invites</p>
            <p className="activity-stat-value mt-1 text-xl font-semibold text-zinc-100">{visibleCounts.ACCESS + visibleCounts.INVITES}</p>
          </div>
          <div className="activity-stat-card rounded-xl border border-zinc-900 bg-zinc-950/40 p-3">
            <p className="activity-stat-label text-[11px] text-zinc-500">Newest event</p>
            <p className="activity-stat-subtext mt-1 text-sm font-medium text-zinc-300">{newestVisibleAt ? timeAgo(newestVisibleAt) : 'N/A'}</p>
          </div>
        </div>

        {(() => {
          const attentionItems = [...logs]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .filter((log) => inSelectedRange(log.createdAt, range) && needsAttention(log))
            .slice(0, 5);

          if (attentionItems.length === 0) {
            return (
              <div className="mb-5 rounded-xl border border-zinc-900 bg-zinc-950/40 p-3">
                <p className="text-xs text-zinc-300 font-medium">Needs attention</p>
                <p className="text-[11px] text-zinc-500 mt-1">No urgent events in the selected time range.</p>
              </div>
            );
          }

          return (
            <div className="mb-5 rounded-xl border border-blue-600/25 bg-zinc-950/40 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs text-zinc-100 font-medium">Needs attention now</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-600/15 text-blue-300 border border-blue-600/25">
                  {attentionItems.length} items
                </span>
              </div>
              <div className="space-y-2">
                {attentionItems.map((log) => (
                  <div key={`attention-${log.id}`} className="rounded-lg border border-zinc-900 bg-zinc-950/70 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-zinc-200 truncate">{customerEventText(log)}</p>
                      <span className="text-[10px] text-zinc-500 shrink-0">{timeAgo(log.createdAt)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      {log.targetType === 'conversation' ? (
                        <Link
                          href={`/inbox?conversationId=${encodeURIComponent(log.targetId ?? '')}`}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700"
                        >
                          Open Inbox
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : null}
                      {log.action === 'CONVERSATION_ESCALATED' && log.targetId ? (
                        <Link
                          href={`/resolution?conversationId=${encodeURIComponent(log.targetId)}`}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-blue-600/30 text-blue-300 hover:bg-blue-600/10"
                        >
                          Review Escalation
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Filters */}
        <div className="sticky top-0 z-20 mb-5 rounded-xl border border-zinc-900 bg-zinc-950/95 backdrop-blur p-3 space-y-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search actor, action, target, or metadata"
              className="w-full h-9 rounded-lg bg-zinc-900 border border-zinc-800 pl-9 pr-3 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-600/50"
            />
          </div>

          <div className="activity-category-filters flex flex-wrap items-center gap-1.5">
            {(
              [
                ['ALL', 'All'],
                ['CONVERSATIONS', 'Conversations'],
                ['ESCALATIONS', 'Escalations'],
                ['ACCESS', 'Access'],
                ['INVITES', 'Invites'],
                ['OTHER', 'Other'],
              ] as Array<[ActivityCategory, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setCategory(value)}
                className={`activity-filter-btn text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  category === value
                    ? 'is-active border-blue-600/30 bg-blue-600/10 text-blue-200'
                    : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                {label} ({categoryCounts[value]})
              </button>
            ))}
          </div>

          <div className="activity-range-filters flex items-center gap-1.5">
            {(
              [
                ['24H', '24h'],
                ['7D', '7d'],
                ['30D', '30d'],
                ['ALL', 'All time'],
              ] as Array<[TimeRange, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setRange(value)}
                className={`activity-filter-btn text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  range === value
                    ? 'is-active border-blue-600/30 bg-blue-600/10 text-blue-200'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-zinc-500">{filteredLogs.length} shown</span>
            <button
              onClick={() => {
                setQuery('');
                setCategory('ALL');
                setRange('7D');
              }}
              className="text-[11px] px-2 py-1 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 bg-zinc-800 rounded w-2/3" />
                  <div className="h-2 bg-zinc-800 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Activity className="w-10 h-10 text-zinc-800 mb-4" />
            <p className="text-sm text-zinc-600 font-light">No matching activity</p>
            <p className="text-xs text-zinc-700 font-light mt-1">Try broadening your filters or date range</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedLogs.map(([day, items]) => (
              <section key={day} className="space-y-2">
                <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">{day}</h2>

                <div className="rounded-xl border border-zinc-900 bg-zinc-950/30 divide-y divide-zinc-900">
                  {items.map((log) => {
                    const Icon = ACTION_ICONS[log.action] ?? Activity;
                    const summary = customerEventText(log);
                    const initials = getInitials(log.actorName);
                    const isEscalation = log.action === 'CONVERSATION_ESCALATED';
                    const isAccessChange = log.action === 'MEMBER_ROLE_CHANGED' || log.action === 'MEMBER_REMOVED';

                    return (
                      <div key={log.id} className="p-3 sm:p-3.5">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                            isEscalation
                              ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                              : isAccessChange
                                ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                                : 'bg-blue-600/10 border-blue-600/25 text-blue-200'
                          }`}>
                            {initials || <Icon className="w-3.5 h-3.5" />}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              <span className="text-sm text-zinc-100">{summary}</span>
                              {log.metadata && typeof log.metadata === 'object' && 'newRole' in log.metadata ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-blue-600/30 text-blue-200 bg-blue-600/10">
                                  role: {String(log.metadata.newRole)}
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-[11px] text-zinc-500" title={formatTime(log.createdAt)}>
                                {timeAgo(log.createdAt)}
                              </span>
                              {log.targetType ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500">
                                  {log.targetType}
                                </span>
                              ) : null}
                              {log.targetId ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500">
                                  {log.targetId}
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {log.targetType === 'conversation' ? (
                                <Link
                                  href={`/inbox?conversationId=${encodeURIComponent(log.targetId ?? '')}`}
                                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700"
                                >
                                  Open Inbox
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              ) : null}

                              {log.action === 'CONVERSATION_ESCALATED' && log.targetId ? (
                                <Link
                                  href={`/resolution?conversationId=${encodeURIComponent(log.targetId)}`}
                                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-blue-600/30 text-blue-300 hover:bg-blue-600/10"
                                >
                                  Open Escalation
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              ) : null}

                              <button
                                onClick={() => copyToClipboard(log.targetId ?? log.id)}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                              >
                                Copy ID
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>

                            <details className="mt-2 rounded-md border border-zinc-900 bg-zinc-950/50">
                              <summary className="cursor-pointer px-2 py-1 text-[11px] text-zinc-500 hover:text-blue-200">
                                Audit details
                              </summary>
                              <div className="border-t border-zinc-900 px-2 py-2 space-y-1 text-[11px] text-zinc-500">
                                <p>Action key: {log.action}</p>
                                <p>Target type: {log.targetType ?? 'N/A'}</p>
                                <p>Target ID: {log.targetId ?? 'N/A'}</p>
                                <p>Created: {formatTime(log.createdAt)}</p>
                                <pre className="mt-1 p-2 rounded bg-zinc-950 border border-zinc-900 overflow-auto text-[10px] text-zinc-400">
                                  {JSON.stringify(log.metadata ?? {}, null, 2)}
                                </pre>
                              </div>
                            </details>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
