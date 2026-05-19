'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, Send, Sparkles, User2, AlertTriangle, CheckCircle2, Clock, BotIcon, Search, X, Eye, EyeOff, Info, ArrowLeft } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { botsApi, conversationsApi, orgsApi } from '@/lib/api';

interface Conversation {
  id: string;
  channel?: string | null;
  telegramChatId: string | null;
  customerName?: string | null;
  customerUsername?: string | null;
  customerEmail?: string | null;
  emailSubject?: string | null;
  status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ESCALATED';
  mode: 'AI' | 'HUMAN';
  assignedAgentId?: string | null;
  assignedAgent?: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  bot: { id: string; name: string };
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
}

interface ConversationDetails extends Conversation {
  previousConversations?: Conversation[];
  escalationHistory?: Array<{
    id: string;
    action: string;
    actorName: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }>;
}

interface AgentOption {
  id: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
}

interface BotOption {
  id: string;
  name: string;
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

function messageDateKey(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function messageDateLabel(date: string) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';

  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export default function InboxPage() {
  useSearchParams();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<ConversationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'PENDING' | 'ESCALATED' | 'RESOLVED'>('OPEN');
  const [botFilter, setBotFilter] = useState<string>('ALL');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [bots, setBots] = useState<BotOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [mobileShowConv, setMobileShowConv] = useState(false);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [mobileCustomerPanelOpen, setMobileCustomerPanelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const filterRef = useRef({ statusFilter, botFilter, agentFilter });

  useEffect(() => {
    filterRef.current = { statusFilter, botFilter, agentFilter };
  }, [statusFilter, botFilter, agentFilter]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    orgsApi.list().then((res) => {
      const orgs = res.data;
      if (orgs.length > 0) {
        setOrgId(orgs[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      botsApi.list(orgId),
      orgsApi.listMembers(orgId),
    ])
      .then(([botsRes, membersRes]) => {
        setBots((botsRes.data ?? []).map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })));
        setAgents(
          (membersRes.data ?? []).map((m: {
            role: 'OWNER' | 'ADMIN' | 'AGENT';
            user: { id: string; name?: string | null; email: string };
          }) => ({
            id: m.user.id,
            name: m.user.name || m.user.email,
            role: m.role,
          })),
        );
      })
      .catch(() => {});
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    const params: Record<string, string | undefined> = {};
    if (statusFilter !== 'ALL') params.status = statusFilter;
    if (botFilter !== 'ALL') params.botId = botFilter;
    if (agentFilter !== 'ALL') {
      params.assignedAgentId = agentFilter === 'UNASSIGNED' ? 'unassigned' : agentFilter;
    }
    if (debouncedSearch) params.q = debouncedSearch;

    conversationsApi.list(orgId, params)
      .then((res) => {
        const list = res.data as Conversation[];
        setConversations(list);
        if (list.length === 0) {
          setSelected(null);
          return;
        }
        if (!selected) {
          setSelected(list[0]);
          return;
        }
        const stillExists = list.some((c) => c.id === selected.id);
        if (!stillExists) setSelected(list[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId, statusFilter, botFilter, agentFilter, debouncedSearch]);

  useEffect(() => {
    if (!orgId || !selected) return;
    setLoadingSelected(true);
    conversationsApi.get(orgId, selected.id)
      .then((res) => setSelected(res.data as ConversationDetails))
      .catch(() => {})
      .finally(() => setLoadingSelected(false));
  }, [selected?.id, orgId]);

  useEffect(() => {
    if (!selected || loadingSelected) return;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 0);
  }, [selected?.id, selected?.messages?.length, loadingSelected]);

  useEffect(() => {
    if (!orgId) return;
    const rawUrl = process.env.NEXT_PUBLIC_API_URL || '';
    // Guard: must be a full URL with hostname, otherwise fall back to localhost
    const apiUrl = /^https?:\/\/.+/.test(rawUrl) ? rawUrl : 'http://localhost:3001';
    // Ensure socket.io uses wss:// on HTTPS pages (mixed content would block ws://)
    const socketUrl = apiUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
    const socket = io(socketUrl, { path: '/ws', transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join', orgId));

    const matchesActiveFilters = (conv: Conversation) => {
      const current = filterRef.current;
      if (current.statusFilter !== 'ALL' && conv.status !== current.statusFilter) return false;
      if (current.botFilter !== 'ALL' && conv.bot?.id !== current.botFilter) return false;
      if (current.agentFilter !== 'ALL') {
        if (current.agentFilter === 'UNASSIGNED') {
          if (conv.assignedAgentId) return false;
        } else if (conv.assignedAgentId !== current.agentFilter) {
          return false;
        }
      }
      return true;
    };

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
      if (!matchesActiveFilters(conv)) return;
      setConversations((prev) => prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]);
    });

    socket.on('conversation:update', (payload: { conversationId: string; status?: string; mode?: string; assignedAgentId?: string | null }) => {
      setConversations((prev) => prev.map((c) => c.id === payload.conversationId
        ? {
          ...c,
          ...(payload.status && { status: payload.status as Conversation['status'] }),
          ...(payload.mode && { mode: payload.mode as Conversation['mode'] }),
          ...(payload.assignedAgentId !== undefined && { assignedAgentId: payload.assignedAgentId }),
        }
        : c,
      ));
      setSelected((prev) => prev && prev.id === payload.conversationId
        ? {
          ...prev,
          ...(payload.status && { status: payload.status as Conversation['status'] }),
          ...(payload.mode && { mode: payload.mode as Conversation['mode'] }),
          ...(payload.assignedAgentId !== undefined && { assignedAgentId: payload.assignedAgentId }),
        }
        : prev,
      );
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [orgId]);

  const handleTakeOver = async () => {
    if (!orgId || !selected) return;
    const res = await conversationsApi.update(orgId, selected.id, { mode: 'HUMAN' });
    setSelected((prev) => prev ? { ...prev, mode: 'HUMAN', assignedAgentId: res.data.assignedAgentId, assignedAgent: res.data.assignedAgent ?? prev.assignedAgent } : prev);
    setConversations((prev) => prev.map((c) => (c.id === selected.id ? { ...c, mode: 'HUMAN', assignedAgentId: res.data.assignedAgentId } : c)));
  };

  const handleResolve = async () => {
    if (!orgId || !selected) return;
    await conversationsApi.update(orgId, selected.id, { status: 'RESOLVED' });
    setSelected((prev) => prev ? { ...prev, status: 'RESOLVED' } : prev);
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

  const openCount = conversations.filter((c) => c.status === 'OPEN').length;
  const escalatedCount = conversations.filter((c) => c.status === 'ESCALATED').length;

  const statusOptions = [
    { key: 'ALL' as const, label: 'All statuses' },
    { key: 'OPEN' as const, label: 'Open' },
    { key: 'PENDING' as const, label: 'Pending' },
    { key: 'ESCALATED' as const, label: 'Escalated' },
    { key: 'RESOLVED' as const, label: 'Resolved' },
  ];

  const escalationActionLabel = (action: string) => {
    const map: Record<string, string> = {
      AGENT_TOOK_OVER: 'Agent took over',
      CONVERSATION_ESCALATED: 'Conversation escalated',
      CONVERSATION_ASSIGNED: 'Conversation assigned',
      CONVERSATION_RESOLVED: 'Conversation resolved',
    };
    return map[action] ?? action;
  };

  const CustomerPanelContent = () => (
    <>
      <section className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-3">
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">
          {selected?.channel === 'EMAIL' ? 'Email customer' : selected?.telegramChatId ? 'Telegram user' : 'Widget visitor'}
        </h3>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-500">Name</span>
            <span className="text-zinc-200 truncate max-w-[190px] text-right">
              {selected?.customerName || (selected?.channel === 'EMAIL' ? '—' : selected?.telegramChatId ? 'Unknown' : 'Anonymous')}
            </span>
          </div>
          {selected?.channel === 'EMAIL' ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Email</span>
              <span className="text-zinc-200 font-mono truncate max-w-[190px] text-right">{selected?.customerEmail || '—'}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">Username</span>
                <span className="text-zinc-200 truncate max-w-[190px] text-right">{selected?.customerUsername ? `@${selected.customerUsername}` : '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">Chat ID</span>
                <span className="text-zinc-200 font-mono truncate max-w-[190px] text-right">{selected?.telegramChatId || '—'}</span>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-3">
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Previous conversations</h3>
        {selected?.previousConversations && selected.previousConversations.length > 0 ? (
          <div className="space-y-2">
            {selected.previousConversations.map((prev) => (
              <button
                key={prev.id}
                onClick={() => {
                  setSelected(prev as ConversationDetails);
                  setMobileCustomerPanelOpen(false);
                }}
                className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] text-zinc-400">{prev.bot?.name || 'Bot'}</span>
                  <span className="text-[10px] text-zinc-600">{timeSince(prev.updatedAt)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${STATUS_CONFIG[prev.status]?.cls}`}>
                    {STATUS_CONFIG[prev.status]?.label}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${
                    prev.mode === 'AI' ? 'bg-blue-500/15 text-blue-400' : 'bg-orange-500/15 text-orange-400'
                  }`}>
                    {prev.mode}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No previous conversations for this user.</p>
        )}
      </section>

      <section className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-3">
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Escalation history</h3>
        {selected?.escalationHistory && selected.escalationHistory.length > 0 ? (
          <div className="space-y-2">
            {selected.escalationHistory.map((event) => (
              <div key={event.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] text-zinc-200">{escalationActionLabel(event.action)}</span>
                  <span className="text-[10px] text-zinc-600">{timeSince(event.createdAt)}</span>
                </div>
                <p className="text-[10px] text-zinc-500">by {event.actorName}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No escalation events yet.</p>
        )}
      </section>
    </>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel ── */}
      <div className={`${mobileShowConv ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[340px] shrink-0 border-r border-zinc-900 h-full bg-black/20`}>
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

          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer or message"
              className="w-full h-9 rounded-xl bg-zinc-900 border border-zinc-800 pl-9 pr-3 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-600/50"
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-8 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-600/50"
            >
              {statusOptions.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={botFilter}
                onChange={(e) => setBotFilter(e.target.value)}
                className="h-8 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-600/50"
              >
                <option value="ALL">All bots</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="h-8 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-600/50"
              >
                <option value="ALL">All assignees</option>
                <option value="UNASSIGNED">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-zinc-600">{openCount} open</span>
              <span className="text-[10px] text-zinc-600">{escalatedCount} escalated</span>
              <span className="text-[10px] text-zinc-600">{conversations.length} shown</span>
            </div>
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
                const displayName = conv.customerName
                  || (conv.channel === 'EMAIL' ? conv.customerEmail : conv.telegramChatId ? `User ···${conv.telegramChatId.slice(-4)}` : null)
                  || 'Anonymous';
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
                          {conv.channel === 'EMAIL' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-zinc-800 text-zinc-400">email</span>
                          )}
                          {conv.bot?.name && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-zinc-800/80 text-zinc-500 max-w-[90px] truncate">
                              {conv.bot.name}
                            </span>
                          )}
                          {conv.assignedAgent?.name && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-emerald-500/10 text-emerald-400 max-w-[120px] truncate">
                              {conv.assignedAgent.name}
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
      <div className={`${mobileShowConv ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 h-full overflow-hidden`}>
        {selected ? (
          <div className="flex-1 min-w-0 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
              {/* Conv header */}
              <div className="px-6 py-4 border-b border-zinc-900 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setMobileShowConv(false)}
                    className="md:hidden p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors -ml-1 shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium ${
                    selected.status === 'ESCALATED' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {nameInitials(selected.customerName || (selected.channel === 'EMAIL' ? selected.customerEmail : selected.telegramChatId ? `U${selected.telegramChatId.slice(-4)}` : null) || 'Anonymous')}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-sm text-white tracking-tight truncate">
                      {selected.customerName || (selected.channel === 'EMAIL' ? selected.customerEmail : selected.telegramChatId ? `User ···${selected.telegramChatId.slice(-4)}` : 'Anonymous') || 'Anonymous'}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
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
                      {selected.assignedAgent?.name && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-emerald-500/10 text-emerald-400">
                          {selected.assignedAgent.name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMobileCustomerPanelOpen(true)}
                    className="inline-flex lg:hidden items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors text-xs border border-zinc-800"
                  >
                    <Info className="w-3.5 h-3.5" />
                    Info
                  </button>
                  {!customerPanelOpen && (
                    <button
                      onClick={() => setCustomerPanelOpen(true)}
                      aria-label="Show customer panel"
                      title="Show customer panel"
                      className="hidden lg:inline-flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors border border-zinc-800"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
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
                {loadingSelected ? (
                  <div className="space-y-2.5">
                    {[...Array(8)].map((_, i) => (
                      <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                        <div className="h-8 w-[58%] max-w-[420px] rounded-xl bg-zinc-900/70 border border-zinc-800 animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : selected.messages?.length === 0 ? (
                  <p className="text-sm text-zinc-600 font-light text-center mt-16">No messages yet.</p>
                ) : selected.messages?.map((msg, index) => {
                  const showDateSeparator =
                    index === 0 ||
                    messageDateKey(selected.messages[index - 1].createdAt) !== messageDateKey(msg.createdAt);
                  const isUser = msg.role === 'USER';
                  const isAgent = msg.role === 'AGENT';
                  return (
                    <div key={msg.id}>
                      {showDateSeparator && (
                        <div className="flex justify-center py-1.5">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500">
                            {messageDateLabel(msg.createdAt)}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                        {isUser && (
                          <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] text-zinc-500 shrink-0 mr-2 mt-1">
                            {nameInitials(selected.customerName || 'U')}
                          </div>
                        )}
                        <div className={`max-w-[62%] px-3 py-2 rounded-xl text-xs leading-snug ${
                          isUser
                            ? 'bg-zinc-900 text-zinc-200 rounded-tl-md'
                            : isAgent
                              ? 'bg-orange-500/15 text-orange-100 border border-orange-500/20 rounded-tr-md'
                              : 'bg-blue-600/20 text-blue-100 border border-blue-500/20 rounded-tr-md'
                        }`}>
                          {isUser || isAgent ? (
                            <p className="font-light whitespace-pre-wrap">{msg.content}</p>
                          ) : (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                p: ({ children }) => <p className="font-light leading-snug mb-1 last:mb-0">{children}</p>,
                                h1: ({ children }) => <h1 className="text-sm font-semibold mb-1.5">{children}</h1>,
                                h2: ({ children }) => <h2 className="text-xs font-semibold mb-1.5">{children}</h2>,
                                h3: ({ children }) => <h3 className="text-xs font-semibold mb-1">{children}</h3>,
                                ul: ({ children }) => <ul className="list-disc ml-4 space-y-0.5 mb-1">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal ml-4 space-y-0.5 mb-1">{children}</ol>,
                                li: ({ children }) => <li className="leading-snug">{children}</li>,
                                code: ({ children, ...props }: any) =>
                                  props.inline
                                    ? <code className="px-1 py-0.5 rounded bg-zinc-900/60 border border-zinc-700 text-[11px]">{children}</code>
                                    : <code className="block p-2 rounded-lg bg-zinc-900/60 border border-zinc-700 overflow-x-auto text-[11px]">{children}</code>,
                                pre: ({ children }) => <pre className="mb-1">{children}</pre>,
                                a: ({ href, children }) => (
                                  <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-blue-200 hover:text-blue-100">
                                    {children}
                                  </a>
                                ),
                                blockquote: ({ children }) => (
                                  <blockquote className="border-l-2 border-blue-300/40 pl-2 italic text-blue-100/90 mb-1">
                                    {children}
                                  </blockquote>
                                ),
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          )}
                          <p className="text-[9px] mt-1 opacity-50 font-normal">
                            {isUser ? 'Customer' : isAgent ? 'Agent' : 'AI'} · {timeSince(msg.createdAt)}
                          </p>
                        </div>
                        {!isUser && (
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ml-2 mt-1 ${
                            isAgent ? 'bg-orange-500/20' : 'bg-blue-600/20'
                          }`}>
                            {isAgent ? <User2 className="w-2.5 h-2.5 text-orange-400" /> : <BotIcon className="w-2.5 h-2.5 text-blue-400" />}
                          </div>
                        )}
                      </div>
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
            </div>

            {/* Customer context sidebar */}
            {customerPanelOpen && (
              <aside className="hidden lg:flex w-[300px] xl:w-[320px] shrink-0 border-l border-zinc-900 bg-zinc-950/40 p-4 flex-col gap-4 overflow-y-auto">
                <div className="flex items-center justify-between gap-3 pb-1">
                  <h3 className="text-sm font-semibold text-white">Customer context</h3>
                  <button
                    onClick={() => setCustomerPanelOpen(false)}
                    aria-label="Hide customer panel"
                    title="Hide customer panel"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors border border-zinc-800"
                  >
                    <EyeOff className="w-4 h-4" />
                  </button>
                </div>
                <CustomerPanelContent />
              </aside>
            )}

            {mobileCustomerPanelOpen && (
              <div className="lg:hidden fixed inset-0 z-40">
                <button
                  aria-label="Close customer panel backdrop"
                  onClick={() => setMobileCustomerPanelOpen(false)}
                  className="absolute inset-0 bg-black/60"
                />
                <div className="absolute right-0 top-0 h-full w-[88vw] max-w-[380px] bg-zinc-950 border-l border-zinc-900 flex flex-col">
                  <div className="px-4 py-3 border-b border-zinc-900 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Customer context</h3>
                    <button
                      onClick={() => setMobileCustomerPanelOpen(false)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <CustomerPanelContent />
                  </div>
                </div>
              </div>
            )}
          </div>
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
