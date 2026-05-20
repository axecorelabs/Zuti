'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { MessageSquareText, Send, Users } from 'lucide-react';
import { orgsApi, teamChatApi } from '@/lib/api';

interface TeamChatMessage {
  id: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  sender: { id: string; name?: string | null; email: string };
}

interface OrgMember {
  role: 'OWNER' | 'ADMIN' | 'AGENT';
  user: { id: string; name?: string | null; email: string };
}

function timeLabel(value: string) {
  const d = new Date(value);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function TeamChatPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    orgsApi.list()
      .then((res) => {
        if ((res.data ?? []).length > 0) setOrgId(res.data[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!orgId) return;

    setLoading(true);
    Promise.all([
      teamChatApi.listMessages(orgId, { limit: 100 }),
      orgsApi.listMembers(orgId),
    ])
      .then(([msgsRes, membersRes]) => {
        setMessages(msgsRes.data ?? []);
        setMembers(membersRes.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;

    const rawUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const apiUrl = /^https?:\/\/.+/.test(rawUrl) ? rawUrl : 'http://localhost:3001';
    const socketUrl = apiUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const socket = io(socketUrl, { path: '/ws', transports: ['websocket'], auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join', orgId));
    socket.on('team:message:new', (msg: TeamChatMessage) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [orgId]);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 0);
  }, [messages.length]);

  const groupedMembers = useMemo(() => {
    const buckets: Record<'OWNER' | 'ADMIN' | 'AGENT', OrgMember[]> = {
      OWNER: [], ADMIN: [], AGENT: [],
    };
    members.forEach((m) => buckets[m.role].push(m));
    return buckets;
  }, [members]);

  const handleSend = async () => {
    if (!orgId || !input.trim() || sending) return;
    setSending(true);
    try {
      const res = await teamChatApi.sendMessage(orgId, input.trim());
      setInput('');
      setMessages((prev) => (prev.some((m) => m.id === res.data.id) ? prev : [...prev, res.data]));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
    } catch {
      // ignore for now
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <div className="px-6 py-4 border-b border-zinc-900 flex items-center justify-between">
          <div>
            <h1 className="font-brand font-semibold text-lg tracking-tight text-white">Team Chat</h1>
            <p className="text-xs text-zinc-500 mt-0.5">Internal workspace chat for support coordination</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((k) => <div key={k} className="h-10 rounded-xl bg-zinc-900/70 border border-zinc-800 animate-pulse" />)}
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <MessageSquareText className="w-8 h-8 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">No team messages yet</p>
            </div>
          ) : (
            messages.map((msg) => {
              const senderName = msg.sender.name || msg.sender.email;
              const isEscalationNotice = (msg.metadata as any)?.kind === 'escalation_assigned';
              return (
                <div key={msg.id} className={`rounded-xl border px-3 py-2.5 ${isEscalationNotice ? 'bg-amber-500/10 border-amber-500/20' : 'bg-zinc-900/50 border-zinc-800'}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center text-[10px] font-medium">
                      {initials(senderName)}
                    </div>
                    <p className="text-xs text-zinc-200">{senderName}</p>
                    <span className="text-[10px] text-zinc-600 ml-auto">{timeLabel(msg.createdAt)}</span>
                  </div>
                  <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-snug">{msg.content}</p>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-6 py-4 border-t border-zinc-900">
          <div className="flex items-end gap-3 bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Message your team..."
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center shrink-0"
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>
      </div>

      <aside className="hidden lg:flex w-[300px] shrink-0 border-l border-zinc-900 bg-zinc-950/40 p-4 flex-col gap-4 overflow-y-auto">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm text-zinc-200">Team members</h2>
        </div>

        {(['OWNER', 'ADMIN', 'AGENT'] as const).map((role) => (
          <section key={role} className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-3">
            <h3 className="text-[11px] text-zinc-500 mb-2">{role}</h3>
            <div className="space-y-1.5">
              {groupedMembers[role].length === 0 ? (
                <p className="text-xs text-zinc-700">No members</p>
              ) : groupedMembers[role].map((m) => (
                <div key={m.user.id} className="text-xs text-zinc-300 truncate">
                  {m.user.name || m.user.email}
                </div>
              ))}
            </div>
          </section>
        ))}
      </aside>
    </div>
  );
}
