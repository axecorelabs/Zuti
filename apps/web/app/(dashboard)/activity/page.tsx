'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { orgsApi, activityApi } from '@/lib/api';
import { Activity, UserPlus, UserMinus, ShieldCheck, MessageSquare, ArrowUpRight, Send } from 'lucide-react';

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
  MEMBER_JOINED: UserPlus,
  MEMBER_REMOVED: UserMinus,
  MEMBER_ROLE_CHANGED: ShieldCheck,
  INVITATION_SENT: Send,
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

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function ActivityPage() {
  const router = useRouter();
  const { getRoleForOrg } = useAuthStore();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    orgsApi.list().then((res) => {
      const list = res.data as { id: string; members?: { role: string }[] }[];
      if (!list.length) return;
      const first = list[0];
      const role = first.members?.[0]?.role ?? getRoleForOrg(first.id);
      if (role === 'AGENT') {
        router.replace('/inbox');
        return;
      }
      setOrgId(first.id);
    }).catch(() => setLoading(false));
  }, [getRoleForOrg, router]);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    activityApi
      .list(orgId)
      .then((res) => setLogs(res.data as ActivityLog[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
            <Activity className="w-4 h-4 text-zinc-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Activity</h1>
            <p className="text-xs text-zinc-500 font-light">Audit trail — all workspace events</p>
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
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Activity className="w-10 h-10 text-zinc-800 mb-4" />
            <p className="text-sm text-zinc-600 font-light">No activity yet</p>
            <p className="text-xs text-zinc-700 font-light mt-1">Events will appear here as things happen</p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-zinc-800" />

            <div className="space-y-1">
              {logs.map((log) => {
                const Icon = ACTION_ICONS[log.action] ?? Activity;
                const label = ACTION_LABELS[log.action] ?? log.action.toLowerCase().replace(/_/g, ' ');
                const initials = getInitials(log.actorName);

                return (
                  <div key={log.id} className="relative flex items-start gap-4 pl-4 py-3 group">
                    {/* Avatar */}
                    <div className="relative z-10 shrink-0">
                      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[11px] font-semibold text-zinc-300 -ml-4">
                        {initials || <Icon className="w-3.5 h-3.5" />}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-white">{log.actorName}</span>
                        <span className="text-sm text-zinc-400 font-light">{label}</span>
                        {log.metadata && typeof log.metadata === 'object' && 'newRole' in log.metadata && (
                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-400 font-medium">
                            {String(log.metadata.newRole)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-zinc-600">{formatTime(log.createdAt)}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-500">
                          <Icon className="w-2.5 h-2.5" />
                          {log.action}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
