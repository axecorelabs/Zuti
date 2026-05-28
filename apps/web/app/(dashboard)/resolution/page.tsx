'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageSquareText, RefreshCw } from 'lucide-react';
import { orgsApi, teamChatApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type ThreadStatus = 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DUPLICATE';

type EscalationThread = {
  id: string;
  topic?: string | null;
  question: string;
  status: ThreadStatus;
  conversation?: { id: string } | null;
  assignedUser?: { id: string; name?: string | null; email: string } | null;
  replies: Array<{
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; name?: string | null; email: string };
  }>;
};

export default function ResolutionPage() {
  const { activeOrgId } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const targetThreadIdParam = searchParams.get('threadId');
  const targetConversationIdParam = searchParams.get('conversationId');

  const [orgId, setOrgId] = useState<string | null>(null);
  const [threads, setThreads] = useState<EscalationThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadReplyingId, setThreadReplyingId] = useState<string | null>(null);
  const [updatingThreadId, setUpdatingThreadId] = useState<string | null>(null);
  const [threadReplyDrafts, setThreadReplyDrafts] = useState<Record<string, string>>({});

  const loadData = async (targetOrgId: string) => {
    setLoading(true);
    try {
      const threadsRes = await teamChatApi.listEscalationThreads(targetOrgId);
      setThreads(threadsRes.data ?? []);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
    }
  };

  const STATUS_ORDER: ThreadStatus[] = ['OPEN', 'ANSWERED', 'RESOLVED', 'DUPLICATE'];

  useEffect(() => {
    orgsApi.list()
      .then((res) => {
        const orgs = (res.data ?? []) as Array<{ id: string }>;
        if (orgs.length > 0) {
          const preferred = activeOrgId
            ? (orgs.find((org) => org.id === activeOrgId) ?? orgs[0])
            : orgs[0];
          setOrgId(preferred.id);
          loadData(preferred.id);
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [activeOrgId]);

  const highlightedThreadId = useMemo(() => {
    if (targetThreadIdParam && threads.some((t) => t.id === targetThreadIdParam)) {
      return targetThreadIdParam;
    }
    if (targetConversationIdParam) {
      const match = threads.find((t) => t.conversation?.id === targetConversationIdParam);
      return match?.id ?? null;
    }
    return null;
  }, [threads, targetThreadIdParam, targetConversationIdParam]);

  useEffect(() => {
    if (!highlightedThreadId) return;
    const el = document.getElementById(`thread-${highlightedThreadId}`);
    if (!el) return;
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }, [highlightedThreadId]);

  const openCount = useMemo(() => threads.filter((t) => t.status === 'OPEN').length, [threads]);

  const replyToThread = async (threadId: string) => {
    if (!orgId || !threadReplyDrafts[threadId]?.trim() || threadReplyingId) return;
    setThreadReplyingId(threadId);
    try {
      const res = await teamChatApi.replyToEscalationThread(orgId, threadId, threadReplyDrafts[threadId].trim());
      setThreadReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
      setThreads((prev) => prev.map((thread) => (
        thread.id === threadId
          ? { ...thread, status: res.data.thread.status, replies: [...(thread.replies ?? []), res.data.reply] }
          : thread
      )));
    } catch {
      // ignore for now
    } finally {
      setThreadReplyingId(null);
    }
  };

  const updateThreadStatus = async (threadId: string, status: ThreadStatus) => {
    if (!orgId || updatingThreadId) return;
    setUpdatingThreadId(threadId);
    try {
      const res = await teamChatApi.updateEscalationThreadStatus(orgId, threadId, status);
      setThreads((prev) => prev.map((thread) => (
        thread.id === threadId ? { ...thread, status: res.data.status } : thread
      )));
    } catch {
      // ignore for now
    } finally {
      setUpdatingThreadId(null);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Escalations</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">
            Prioritize high-risk customer cases and unblock agents quickly.
          </p>
        </div>
        <button
          onClick={() => orgId && loadData(orgId)}
          disabled={loading || !orgId}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mb-6 card p-2 flex items-center gap-1 w-fit">
          <span className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-100">Escalations ({openCount})</span>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-zinc-900/70 border border-zinc-800 animate-pulse" />)}
          </div>
        ) : threads.length === 0 ? (
          <div className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-5 text-sm text-zinc-500">
            No escalations yet.
          </div>
        ) : (
          threads.map((thread) => (
            <div
              id={`thread-${thread.id}`}
              key={thread.id}
              className={`rounded-xl border p-4 ${
                highlightedThreadId === thread.id
                  ? 'border-zinc-700 bg-zinc-900/70'
                  : 'border-zinc-900 bg-zinc-950/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <MessageSquareText className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-zinc-100">{thread.topic || 'Escalation thread'}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300">
                      {thread.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-2 whitespace-pre-wrap">{thread.question}</p>

                  <details className="mt-2 rounded-md border border-zinc-800/70 bg-zinc-950/50">
                    <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors">
                      Metadata
                    </summary>
                    <div className="border-t border-zinc-900 px-2.5 py-2 text-[11px] text-zinc-400 space-y-1">
                      <p>Thread ID: {thread.id}</p>
                      <p>Conversation ID: {thread.conversation?.id ?? 'N/A'}</p>
                      <p>Assigned: {thread.assignedUser?.name || thread.assignedUser?.email || 'Unassigned'}</p>
                      <p>Replies: {thread.replies.length}</p>
                    </div>
                  </details>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {STATUS_ORDER.map((status) => (
                      <button
                        key={status}
                        onClick={() => updateThreadStatus(thread.id, status)}
                        disabled={updatingThreadId === thread.id || thread.status === status}
                        className={`text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                          thread.status === status
                            ? 'border-zinc-600 text-zinc-100 bg-zinc-800'
                            : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 rounded-lg border border-zinc-900 bg-zinc-950 p-3">
                    <textarea
                      value={threadReplyDrafts[thread.id] ?? ''}
                      onChange={(e) => setThreadReplyDrafts((prev) => ({ ...prev, [thread.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          replyToThread(thread.id);
                        }
                      }}
                      rows={3}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-200 resize-none focus:outline-none focus:border-zinc-600"
                      placeholder="Write a reply (Cmd/Ctrl+Enter to send)"
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => replyToThread(thread.id)}
                        disabled={!threadReplyDrafts[thread.id]?.trim() || threadReplyingId === thread.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-zinc-200 hover:bg-white disabled:opacity-50 text-zinc-900"
                      >
                        {threadReplyingId === thread.id ? 'Sending...' : 'Reply'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
