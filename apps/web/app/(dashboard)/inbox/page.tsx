'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, Send, Sparkles, User2, AlertTriangle, CheckCircle2, Clock, BotIcon, ArrowLeft } from 'lucide-react';
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

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  OPEN: { label: 'Open', cls: 'bg-blue-500/15 text-blue-400', icon: Clock },
  PENDING: { label: 'Pending', cls: 'bg-orange-500/15 text-orange-400', icon: Clock },
  RESOLVED: { label: 'Resolved', cls: 'bg-zinc-800 text-zinc-500', icon: CheckCircle2 },
  ESCALATED: { label: 'Escalated', cls: 'bg-red-500/15 text-red-400', icon: AlertTriangle },
};

function timeSince(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function nameInitials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function InboxPage() {
  useSearchParams();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'ESCALATED'>('OPEN');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [mobileShowConv, setMobileShowConv] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const filterRef = useRef(filter);

  useEffect(() => { filterRef.current = filter; }, [filter]);

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
    conversationsApi.list(orgId, params)
      .then((res) => {
        setConversations(res.data);
        if (res.data.length > 0 && !selected) setSelected(res.data[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId, filter]);

  useEffect(() => {
    if (!orgId || !selected) return;
    conversationsApi.get(orgId, selected.id).then((res) => setSelected(res.data)).catch(() => {});
  }, [selected?.id, orgId]);

  useEffect(() => {
    if (!orgId) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const socketUrl = apiUrl.startsWith('http') ? apiUrl : `http://${apiUrl}`;
    const socket = io(socketUrl, { path: '/ws', transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join', orgId));

    socket.on('message:new', (payload: {
      conversationId: string;
      message: { id: string; role: string; content: string; createdAt: string };
    }) => {
      setSelected((prev) => {
        if (!prev || prev.id !== payload.conversationId) return prev;
        if (prev.messages?.some((m) => m.id === payload.message.id)) return prev;
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        return { ...prev, messages: [...(prev.messages ?? []), payload.message] };
      });
      setConversations((prev) =>
        [...prev.map((c) => c.id === payload.conversationId
          ? { ...c, updatedAt: payload.message.createdAt, messages: [payload.message] }
          : c,
        )].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      );
    });

    socket.on('conversation:new', (conv: Conversation) => {
      const f = filterRef.current;
      if (f !== 'ALL' && conv.status !== f) return;
      setConversations((prev) => prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]);
    });

    socket.on('conversation:update', (payload: { conversationId: string; status?: string; mode?: string }) => {
      setConversations((prev) => prev.map((c) => c.id === payload.conversationId
        ? { ...c, ...(payload.status && { status: payload.status as Conversation['status'] }), ...(payload.mode && { mode: payload.mode as Conversation['mode'] }) }
        : c,
      ));
      setSelected((prev) => prev && prev.id === payload.conversationId
        ? { ...prev, ...(payload.status && { status: payload.status as Conversation['status'] }), ...(payload.mode && { mode: payload.mode as Conversation['mode'] }) }
        : prev,
      );
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [orgId]);

  const handleTakeOver = async () => {
    if (!orgId || !selected) return;
    const res = await conversationsApi.update(orgId, selected.id, { mode: 'HUMAN' });
    setSelected(res.data);
    setConversations((prev) => prev.map((c) => (c.id === selected.id ? { ...c, mode: 'HUMAN' } : c)));
  };

  const handleResolve = async () => {
    if (!orgId || !selected) return;
    const res = await conversationsApi.update(orgId, selected.id, { status: 'RESOLVED' });
    setSelected(res.data);
    setConversations((prev) => prev.map((c) => (c.id === selected.id ? { ...c, status: 'RESOLVED' } : c)));
  };

  const handleSend = async () => {
    if (!orgId || !selected || !reply.trim() || sending) return;
    setSending(true);
    try {
      const res = await conversationsApi.sendMessage(orgId, selected.id, reply.trim());
      setReply('');
      setSelected((prev) => prev ? { ...prev, messages: [...(prev.messages ?? []), res.data] } : prev);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch { /* ignore */ } finally { setSending(false); }
  };

  const FILTERS = [
    { key: 'OPEN' as const, label: 'Open' },
    { key: 'ESCALATED' as const, label: 'Escalated' },
    { key: 'ALL' as const, label: 'All' },
  ];

  const openCount = conversations.filter((c) => c.status === 'OPEN').length;
  const escalatedCount = conversations.filter((c) => c.status === 'ESCALATED').length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel ── */}
      <div className={`${mobileShowConv ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[300px] shrink-0 border-r border-zinc-900 h-full bg-black/20`}>
        {/* Header */}
        <div className="px-5 pt-6 pb-4 border-b border-zinc-900">
          <div className="flex items-center justify-between mb-4">
            <h1 className="font-brand font-semibold text-lg tracking-tight text-white">Inbox</h1>
            {escalatedCount > 0 && (
              <span className="bg-red-500/15 text-red-400 text-[10px] px-2 py-0.5 rounded-full font-medium">
                {escalatedCount} escalated
              </span>
            )}
          </div>
          {/* Filter tabs */}
          <div className="flex gap-1 bg-zinc-900 rounded-xl p-1">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`flex-1 text-xs py-1.5 rounded-lg transition-all font-normal ${
                  filter === key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-[72px] bg-zinc-900/50 animate-pulse rounded-xl" />)}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <MessageSquare className="w-8 h-8 text-zinc-800 mb-3" />
              <p className="text-sm text-zinc-600 font-light">No conversations</p>
            </div>
          ) : (
            <div className="py-2 px-2 space-y-0.5">
              {conversations.map((conv) => {
                const lastMsg = conv.messages?.[conv.messages.length - 1];
                const isActive = selected?.id === conv.id;
                const cfg = STATUS_CONFIG[conv.status] ?? STATUS_CONFIG.OPEN;
                const displayName = conv.customerName || `User ···${conv.telegramChatId.slice(-4)}`;
                return (
                  <button
                    key={conv.id}
                    onClick={() => { setSelected(conv); setMobileShowConv(true); }}
                    className={`w-full text-left px-3 py-3 rounded-xl transition-all ${
                      isActive
                        ? 'bg-blue-600/10 border border-blue-600/30'
                        : 'hover:bg-zinc-900/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Avatar */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 mt-0.5 ${
                        conv.status === 'ESCALATED' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {nameInitials(displayName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className={`text-sm font-normal truncate ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                            {displayName}
                          </span>
                          <span className="text-[10px] text-zinc-600 shrink-0">{timeSince(conv.updatedAt)}</span>
                        </div>
                        <p className="text-xs text-zinc-600 font-light truncate mb-1.5">
                          {lastMsg?.content ?? 'No messages yet'}
                        </p>
                        <div className="flex gap-1 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${cfg.cls}`}>
                            {cfg.label}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${
                            conv.mode === 'AI' ? 'bg-blue-500/15 text-blue-400' : 'bg-orange-500/15 text-orange-400'
                          }`}>
                            {conv.mode === 'AI' ? 'AI' : 'Human'}
                          </span>
                          {conv.bot?.name && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-zinc-800/80 text-zinc-500 max-w-[90px] truncate">
                              {conv.bot.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={`${mobileShowConv ? 'flex' : 'hidden md:flex'} flex-1 flex-col h-full overflow-hidden`}>
        {selected ? (
          <>
            {/* Conv header */}
            <div className="px-6 py-4 border-b border-zinc-900 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileShowConv(false)}
                  className="md:hidden p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors -ml-1 shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium ${
                  selected.status === 'ESCALATED' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {nameInitials(selected.customerName || `U${selected.telegramChatId.slice(-4)}`)}
                </div>
                <div>
                  <h2 className="font-semibold text-sm text-white tracking-tight">
                    {selected.customerName || `User ···${selected.telegramChatId.slice(-4)}`}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-zinc-600 font-light">via {selected.bot?.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${STATUS_CONFIG[selected.status]?.cls}`}>
                      {STATUS_CONFIG[selected.status]?.label}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1 ${
                      selected.mode === 'AI' ? 'bg-blue-500/15 text-blue-400' : 'bg-orange-500/15 text-orange-400'
                    }`}>
                      {selected.mode === 'AI' ? <Sparkles className="w-2.5 h-2.5" /> : <User2 className="w-2.5 h-2.5" />}
                      {selected.mode === 'AI' ? 'AI handling' : 'Human handling'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected.mode === 'AI' && (
                  <button
                    onClick={handleTakeOver}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors text-xs font-medium border border-orange-500/20"
                  >
                    <User2 className="w-3.5 h-3.5" />
                    Take over
                  </button>
                )}
                {selected.status !== 'RESOLVED' && (
                  <button
                    onClick={handleResolve}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500 transition-colors text-xs font-medium"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Resolve
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3">
              {selected.messages?.length === 0 && (
                <p className="text-sm text-zinc-600 font-light text-center mt-16">No messages yet.</p>
              )}
              {selected.messages?.map((msg) => {
                const isUser = msg.role === 'USER';
                const isAgent = msg.role === 'AGENT';
                return (
                  <div key={msg.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                    {isUser && (
                      <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500 shrink-0 mr-2 mt-1">
                        {nameInitials(selected.customerName || 'U')}
                      </div>
                    )}
                    <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      isUser
                        ? 'bg-zinc-900 text-zinc-200 rounded-tl-md'
                        : isAgent
                          ? 'bg-orange-500/15 text-orange-100 border border-orange-500/20 rounded-tr-md'
                          : 'bg-blue-600/20 text-blue-100 border border-blue-500/20 rounded-tr-md'
                    }`}>
                      <p className="font-light">{msg.content}</p>
                      <p className="text-[10px] mt-1.5 opacity-50 font-normal">
                        {isUser ? 'Customer' : isAgent ? 'Agent' : 'AI'} · {timeSince(msg.createdAt)}
                      </p>
                    </div>
                    {!isUser && (
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ml-2 mt-1 ${
                        isAgent ? 'bg-orange-500/20' : 'bg-blue-600/20'
                      }`}>
                        {isAgent ? <User2 className="w-3 h-3 text-orange-400" /> : <BotIcon className="w-3 h-3 text-blue-400" />}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply input */}
            {selected.mode === 'HUMAN' && selected.status !== 'RESOLVED' ? (
              <div className="px-6 py-4 border-t border-zinc-900 shrink-0">
                <div className="flex gap-3 items-end bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-3">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Reply as agent… (Enter to send, Shift+Enter for newline)"
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!reply.trim() || sending}
                    className="w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center shrink-0"
                  >
                    <Send className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
                <p className="text-[10px] text-zinc-700 mt-1.5 text-center">
                  You are replying as a human agent
                </p>
              </div>
            ) : selected.status !== 'RESOLVED' ? (
              <div className="px-6 py-4 border-t border-zinc-900 shrink-0">
                <div className="flex items-center justify-center gap-2 py-3 bg-zinc-900/30 rounded-2xl border border-zinc-900">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs text-zinc-600 font-light">AI is handling this conversation</span>
                  <button onClick={handleTakeOver} className="text-xs text-orange-400 hover:text-orange-300 font-medium ml-1 transition-colors">
                    Take over →
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-6 py-4 border-t border-zinc-900 shrink-0">
                <div className="flex items-center justify-center gap-2 py-3">
                  <CheckCircle2 className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="text-xs text-zinc-600 font-light">Conversation resolved</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-zinc-900 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-7 h-7 text-zinc-700" />
              </div>
              <p className="text-sm text-zinc-600 font-light">Select a conversation to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
