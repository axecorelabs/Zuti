'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, User, Send } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { conversationsApi, orgsApi } from '@/lib/api';

interface Conversation {
  id: string;
  telegramChatId: string;
  customerName?: string | null;
  status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ESCALATED';
  mode: 'AI' | 'HUMAN';
  createdAt: string;
  updatedAt: string;
  bot: { id: string; name: string };
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
}

const statusColors: Record<string, string> = {
  OPEN: 'bg-green-500/20 text-green-400',
  PENDING: 'bg-yellow-500/20 text-yellow-400',
  RESOLVED: 'bg-zinc-700 text-zinc-400',
  ESCALATED: 'bg-red-500/20 text-red-400',
};

const modeColors: Record<string, string> = {
  AI: 'bg-blue-500/20 text-blue-300',
  HUMAN: 'bg-zinc-700 text-zinc-400',
};

function timeSince(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'ESCALATED'>('OPEN');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  // Keep ref in sync with selected id for use inside socket callbacks
  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  useEffect(() => {
    orgsApi.list().then((res) => {
      const orgs = res.data;
      if (orgs.length > 0) setOrgId(orgs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter !== 'ALL') params.status = filter;
    conversationsApi
      .list(orgId, params)
      .then((res) => {
        setConversations(res.data);
        if (res.data.length > 0 && !selected) setSelected(res.data[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId, filter]);

  // Load full conversation when selected
  useEffect(() => {
    if (!orgId || !selected) return;
    conversationsApi.get(orgId, selected.id).then((res) => {
      setSelected(res.data);
    }).catch(() => {});
  }, [selected?.id, orgId]);

  // Socket.io real-time connection
  useEffect(() => {
    if (!orgId) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const socket = io(apiUrl, { path: '/ws', transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', orgId);
    });

    socket.on('message:new', (payload: {
      conversationId: string;
      message: { id: string; role: string; content: string; createdAt: string };
      customerName?: string | null;
    }) => {
      // Append message to the selected conversation if open
      setSelected((prev) => {
        if (!prev || prev.id !== payload.conversationId) return prev;
        const alreadyExists = prev.messages?.some((m) => m.id === payload.message.id);
        if (alreadyExists) return prev;
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        return { ...prev, messages: [...(prev.messages ?? []), payload.message] };
      });

      // Update conversation list: bump updatedAt and last message
      setConversations((prev) =>
        prev.map((c) =>
          c.id === payload.conversationId
            ? { ...c, updatedAt: payload.message.createdAt, messages: [payload.message] }
            : c,
        ),
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [orgId]);

  const handleTakeOver = async () => {
    if (!orgId || !selected) return;
    const res = await conversationsApi.update(orgId, selected.id, { mode: 'HUMAN' });
    setSelected(res.data);
    setConversations((prev) =>
      prev.map((c) => (c.id === selected.id ? { ...c, mode: 'HUMAN' } : c)),
    );
  };

  const handleResolve = async () => {
    if (!orgId || !selected) return;
    const res = await conversationsApi.update(orgId, selected.id, { status: 'RESOLVED' });
    setSelected(res.data);
    setConversations((prev) =>
      prev.map((c) => (c.id === selected.id ? { ...c, status: 'RESOLVED' } : c)),
    );
  };

  const handleSend = async () => {
    if (!orgId || !selected || !reply.trim() || sending) return;
    setSending(true);
    try {
      const res = await conversationsApi.sendMessage(orgId, selected.id, reply.trim());
      setReply('');
      setSelected((prev) =>
        prev ? { ...prev, messages: [...(prev.messages ?? []), res.data] } : prev,
      );
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Left panel: conversation list */}
      <div className="w-80 shrink-0 border-r border-zinc-900 flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-5 border-b border-zinc-900">
          <h1 className="font-brand font-semibold text-lg tracking-tight text-white">
            Inbox
          </h1>

          {/* Filter tabs */}
          <div className="mt-3 flex gap-1 bg-zinc-900 rounded-lg p-1">
            {(['OPEN', 'ALL', 'ESCALATED'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-normal ${
                  filter === f
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-600 hover:text-zinc-300'
                }`}
              >
                {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-zinc-900 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <MessageSquare className="w-8 h-8 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-600 font-light">No conversations</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const lastMsg = conv.messages?.[conv.messages.length - 1];
              const isActive = selected?.id === conv.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelected(conv)}
                  className={`w-full text-left px-4 py-3.5 border-b border-zinc-900/50 hover:bg-zinc-900/30 transition-colors ${
                    isActive ? 'bg-zinc-900/50 border-l-2 border-l-white' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <User className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      <span className="text-sm text-zinc-200 font-normal truncate">
                        {conv.customerName || `User ${conv.telegramChatId.slice(-4)}`}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-600 font-light shrink-0">
                      {timeSince(conv.updatedAt)}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-500 font-light truncate mb-2">
                    {lastMsg?.content ?? 'No messages yet'}
                  </p>

                  <div className="flex gap-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-normal ${statusColors[conv.status]}`}>
                      {conv.status}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-normal ${modeColors[conv.mode]}`}>
                      {conv.mode}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel: conversation detail */}
      <div className="flex-1 flex flex-col h-full">
        {selected ? (
          <>
            {/* Conv header */}
            <div className="px-6 py-4 border-b border-zinc-900 flex items-center justify-between">
              <div>
                <h2 className="font-brand font-semibold text-base tracking-tight text-white">
                  {selected.customerName || `User ${selected.telegramChatId.slice(-4)}`}
                </h2>
                <p className="text-xs text-zinc-600 font-light mt-0.5">
                  via {selected.bot?.name} · {timeSince(selected.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selected.mode === 'AI' && (
                  <button onClick={handleTakeOver} className="btn-secondary py-2 px-4 text-xs">
                    Take over
                  </button>
                )}
                {selected.status !== 'RESOLVED' && (
                  <button onClick={handleResolve} className="btn-primary py-2 px-4 text-xs">
                    Resolve
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selected.messages?.length === 0 && (
                <p className="text-sm text-zinc-600 font-light text-center mt-10">
                  No messages yet.
                </p>
              )}
              {selected.messages?.map((msg) => {
                const isUser = msg.role === 'USER';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-sm px-4 py-2.5 rounded-2xl text-sm font-light leading-relaxed ${
                        isUser
                          ? 'bg-zinc-900 text-zinc-200'
                          : 'bg-zinc-800 text-zinc-100'
                      }`}
                    >
                      {msg.content}
                      <p className="text-[10px] text-zinc-600 mt-1 font-normal">
                        {isUser ? 'User' : msg.role === 'ASSISTANT' ? 'AI' : 'Agent'}
                        {' · '}
                        {timeSince(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply input — only in HUMAN mode */}
            {selected.mode === 'HUMAN' && selected.status !== 'RESOLVED' && (
              <div className="px-6 py-4 border-t border-zinc-900 flex gap-3 items-end">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="Type a message... (Enter to send)"
                  rows={2}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={handleSend}
                  disabled={!reply.trim() || sending}
                  className="btn-primary p-3 rounded-xl disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
              <p className="text-sm text-zinc-600 font-light">
                Select a conversation to view
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
