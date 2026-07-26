'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Search, X, Mail, Phone, MessageSquare, Send, Globe, Download, Trash2, Save,
  GitMerge, Users, ChevronRight, ShieldCheck, Ban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { customersApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type Lifecycle = 'LEAD' | 'ENGAGED' | 'CUSTOMER';
type IdType = 'TELEGRAM_CHAT' | 'WHATSAPP_PHONE' | 'EMAIL' | 'PHONE' | 'WIDGET_SESSION';

interface Identifier { id?: string; type: IdType; value?: string; isAnchor: boolean; verifiedAt?: string | null }
interface Conversation { id: string; channel: string; status: string; lastMessageAt: string | null; createdAt: string; botId: string }
interface CustomerRow {
  id: string; displayName: string | null; primaryEmail: string | null; primaryPhone: string | null;
  lifecycleStage: Lifecycle; tags: string[]; emailOptOut: boolean; firstSeenAt: string; lastSeenAt: string;
  identifiers: Identifier[]; _count?: { conversations: number };
}
interface SalesOrder { id: string; product: string | null; quantity: number | null; unitPriceMinor: number | null; status: string; createdAt: string }
interface CommerceOrder { id: string; totalMinor: number; status: string; createdAt: string }
interface RegistrationEntry { id: string; status: string; amountMinor: number | null; createdAt: string; product: { name: string; currency: string } | null; ticketType: { name: string } | null }
interface Booking { id: string; status: string; createdAt: string }
interface CustomerProfile extends CustomerRow {
  notes: string | null; marketingConsentAt: string | null;
  identifiers: Identifier[]; conversations: Conversation[];
  salesOrders: SalesOrder[]; commerceOrders: CommerceOrder[]; registrationEntries: RegistrationEntry[]; bookings: Booking[];
}

type ActivityItem = { id: string; kind: string; label: string; sub: string; status: string; date: string };
function buildActivity(p: CustomerProfile): ActivityItem[] {
  const money = (minor: number | null | undefined, cur = 'NGN') => (minor && minor > 0 ? `${cur} ${(minor / 100).toLocaleString()}` : null);
  const items: ActivityItem[] = [];
  for (const o of p.salesOrders ?? []) items.push({ id: o.id, kind: 'Order', label: o.product ?? 'Order', sub: [o.quantity ? `×${o.quantity}` : null, money((o.unitPriceMinor ?? 0) * (o.quantity ?? 1))].filter(Boolean).join(' · '), status: o.status, date: o.createdAt });
  for (const o of p.commerceOrders ?? []) items.push({ id: o.id, kind: 'Store order', label: money(o.totalMinor) ?? 'Order', sub: '', status: o.status, date: o.createdAt });
  for (const r of p.registrationEntries ?? []) items.push({ id: r.id, kind: 'Event', label: r.product?.name ?? 'Registration', sub: [r.ticketType?.name, money(r.amountMinor, r.product?.currency)].filter(Boolean).join(' · '), status: r.status, date: r.createdAt });
  for (const b of p.bookings ?? []) items.push({ id: b.id, kind: 'Booking', label: 'Meeting', sub: '', status: b.status, date: b.createdAt });
  return items.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

const ID_META: Record<IdType, { label: string; icon: any }> = {
  TELEGRAM_CHAT: { label: 'Telegram', icon: Send },
  WHATSAPP_PHONE: { label: 'WhatsApp', icon: MessageSquare },
  EMAIL: { label: 'Email', icon: Mail },
  PHONE: { label: 'Phone', icon: Phone },
  WIDGET_SESSION: { label: 'Web chat', icon: Globe },
};
const STAGE_META: Record<Lifecycle, { label: string; cls: string }> = {
  LEAD: { label: 'Lead', cls: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40' },
  ENGAGED: { label: 'Engaged', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  CUSTOMER: { label: 'Customer', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
};
const STAGES: (Lifecycle | 'ALL')[] = ['ALL', 'CUSTOMER', 'ENGAGED', 'LEAD'];

function timeAgo(iso: string | null) {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 2592000) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function CustomersPage() {
  const { activeOrgId } = useAuthStore();
  const orgId = activeOrgId ?? '';

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<Lifecycle | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await customersApi.list(orgId, {
        search: search.trim() || undefined,
        stage: stage === 'ALL' ? undefined : stage,
        includeLeads: stage === 'ALL' ? true : undefined,
        limit: 100,
      });
      setRows(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } catch { toast.error('Failed to load clients'); } finally { setLoading(false); }
  }, [orgId, search, stage]);

  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);

  return (
    <div className="flex h-full min-h-0">
      {/* List */}
      <div className={`flex flex-col border-r border-zinc-800/60 w-full md:w-[380px] md:shrink-0 ${selectedId ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-5 border-b border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-semibold text-white">Clients</h1>
            <span className="text-xs text-zinc-500">{total} {total === 1 ? 'person' : 'people'}</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            />
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  stage === s ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {s === 'ALL' ? 'All' : STAGE_META[s].label + 's'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-3 space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-zinc-900 animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <Users className="w-9 h-9 text-zinc-700 mb-3" />
              <p className="text-sm font-medium text-zinc-400">No clients{search ? ' match' : ' yet'}</p>
              <p className="text-xs text-zinc-600 mt-1">People who message or buy appear here automatically.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {rows.map((c) => {
                const types = [...new Set(c.identifiers.map((i) => i.type))];
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900/60 transition-colors ${selectedId === c.id ? 'bg-zinc-900' : ''}`}
                  >
                    <div className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-300 shrink-0 flex items-center justify-center text-sm font-semibold">
                      {(c.displayName ?? c.primaryEmail ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-zinc-100 truncate font-medium">{c.displayName ?? c.primaryEmail ?? 'Unknown'}</p>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${STAGE_META[c.lifecycleStage].cls}`}>{STAGE_META[c.lifecycleStage].label}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {types.slice(0, 4).map((t) => { const I = ID_META[t].icon; return <I key={t} className="w-3 h-3 text-zinc-500" />; })}
                        <span className="text-[11px] text-zinc-600 truncate">· {timeAgo(c.lastSeenAt)}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-700 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Profile */}
      <div className={`flex-1 min-w-0 ${selectedId ? 'flex' : 'hidden md:flex'} flex-col`}>
        {selectedId ? (
          <CustomerProfilePanel
            key={selectedId}
            orgId={orgId}
            customerId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={load}
            onDeleted={() => { setSelectedId(null); load(); }}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <Users className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500">Select a client to view their profile</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerProfilePanel({ orgId, customerId, onClose, onChanged, onDeleted }: {
  orgId: string; customerId: string; onClose: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const [p, setP] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Editable buffer
  const [displayName, setDisplayName] = useState('');
  const [lifecycle, setLifecycle] = useState<Lifecycle>('LEAD');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState('');
  const [emailOptOut, setEmailOptOut] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customersApi.get(orgId, customerId);
      const c: CustomerProfile = res.data;
      setP(c);
      setDisplayName(c.displayName ?? '');
      setLifecycle(c.lifecycleStage);
      setTags(c.tags ?? []);
      setNotes(c.notes ?? '');
      setEmailOptOut(c.emailOptOut);
      setMarketingConsent(!!c.marketingConsentAt);
    } catch { toast.error('Failed to load profile'); } finally { setLoading(false); }
  }, [orgId, customerId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await customersApi.update(orgId, customerId, {
        displayName, lifecycleStage: lifecycle, tags, notes, emailOptOut, marketingConsent,
      });
      toast.success('Saved');
      await load();
      onChanged();
    } catch { toast.error('Failed to save'); } finally { setSaving(false); }
  };

  const exportData = async () => {
    try {
      const res = await customersApi.export(orgId, customerId);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `customer_${customerId}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  const remove = async () => {
    if (!confirm('Delete this client and all their identity data? Their conversations are kept but unlinked. This cannot be undone.')) return;
    try { await customersApi.remove(orgId, customerId); toast.success('Customer deleted'); onDeleted(); }
    catch { toast.error('Delete failed'); }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  if (loading || !p) {
    return <div className="flex-1 p-6"><div className="h-32 rounded-xl bg-zinc-900 animate-pulse" /></div>;
  }

  const anchors = p.identifiers.filter((i) => i.isAnchor);
  const attributes = p.identifiers.filter((i) => !i.isAnchor);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-5 border-b border-zinc-800/60 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 md:hidden"><X className="w-4 h-4" /></button>
          <div className="w-11 h-11 rounded-full bg-zinc-800 text-zinc-200 shrink-0 flex items-center justify-center text-lg font-semibold">
            {(p.displayName ?? p.primaryEmail ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white truncate">{p.displayName ?? 'Unknown'}</h2>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${STAGE_META[p.lifecycleStage].cls}`}>{STAGE_META[p.lifecycleStage].label}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              First seen {new Date(p.firstSeenAt).toLocaleDateString()} · last active {timeAgo(p.lastSeenAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={exportData} title="Export data (compliance)" className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"><Download className="w-4 h-4" /></button>
          <button onClick={remove} title="Delete client" className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800"><Trash2 className="w-4 h-4" /></button>
          <button onClick={onClose} className="hidden md:block p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-6">
        {/* Identity — channels */}
        <section>
          <h3 className="text-xs font-medium text-zinc-500 mb-2">Channels &amp; identifiers</h3>
          <div className="space-y-1.5">
            {anchors.map((id, i) => { const M = ID_META[id.type]; const I = M.icon; return (
              <div key={id.id ?? i} className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <I className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="text-xs text-zinc-500 w-20 shrink-0">{M.label}</span>
                <span className="text-sm text-zinc-200 truncate flex-1">{id.value}</span>
                <span title="Verified channel of contact" className="shrink-0"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500/70" /></span>
              </div>
            ); })}
            {attributes.map((id, i) => { const M = ID_META[id.type]; const I = M.icon; return (
              <div key={id.id ?? `a${i}`} className="flex items-center gap-2.5 rounded-lg border border-zinc-800/60 bg-zinc-900/20 px-3 py-2">
                <I className="w-4 h-4 text-zinc-600 shrink-0" />
                <span className="text-xs text-zinc-600 w-20 shrink-0">{M.label}</span>
                <span className="text-sm text-zinc-400 truncate flex-1">{id.value}</span>
                <span className="text-[10px] text-zinc-600 shrink-0">provided</span>
              </div>
            ); })}
          </div>
        </section>

        {/* Editable CRM layer */}
        <section className="space-y-4">
          <h3 className="text-xs font-medium text-zinc-500">Details</h3>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Lifecycle</label>
            <div className="flex gap-1.5">
              {(['LEAD', 'ENGAGED', 'CUSTOMER'] as Lifecycle[]).map((s) => (
                <button key={s} onClick={() => setLifecycle(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${lifecycle === s ? STAGE_META[s].cls : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>{STAGE_META[s].label}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 text-xs">
                  {t}<button onClick={() => setTags(tags.filter((x) => x !== t))} className="text-zinc-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="Add a tag, press Enter" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 resize-y" placeholder="Internal notes about this client…" />
          </div>
        </section>

        {/* Consent */}
        <section>
          <h3 className="text-xs font-medium text-zinc-500 mb-2">Consent</h3>
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 cursor-pointer">
              <span className="text-sm text-zinc-300 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-zinc-500" /> Marketing consent (opt-in)</span>
              <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} className="accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 cursor-pointer">
              <span className="text-sm text-zinc-300 flex items-center gap-2"><Ban className="w-4 h-4 text-zinc-500" /> Email opt-out (never email)</span>
              <input type="checkbox" checked={emailOptOut} onChange={(e) => setEmailOptOut(e.target.checked)} className="accent-red-500" />
            </label>
          </div>
        </section>

        {/* Purchases & registrations */}
        {(() => {
          const activity = buildActivity(p);
          if (activity.length === 0) return null;
          return (
            <section>
              <h3 className="text-xs font-medium text-zinc-500 mb-2">Purchases &amp; registrations · {activity.length}</h3>
              <div className="space-y-1.5">
                {activity.slice(0, 30).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                    <span className="text-[10px] font-medium text-zinc-500 w-20 shrink-0 uppercase tracking-wide">{a.kind}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate">{a.label}</p>
                      {a.sub && <p className="text-[11px] text-zinc-500 truncate">{a.sub}</p>}
                    </div>
                    <span className="text-[10px] text-zinc-500 shrink-0">{a.status}</span>
                    <span className="text-[11px] text-zinc-600 shrink-0">{timeAgo(a.date)}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        {/* Activity timeline */}
        <section>
          <h3 className="text-xs font-medium text-zinc-500 mb-2">Conversations · {p.conversations.length}</h3>
          {p.conversations.length === 0 ? (
            <p className="text-xs text-zinc-600">No conversations.</p>
          ) : (
            <div className="space-y-1.5">
              {p.conversations.map((c) => { const M = ID_META[(c.channel + '_CHAT') as IdType] ?? ID_META.EMAIL; return (
                <Link key={c.id} href={`/inbox?org=${orgId}&conversationId=${c.id}`} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 hover:bg-zinc-900 transition-colors">
                  <MessageSquare className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span className="text-xs text-zinc-400 w-20 shrink-0 capitalize">{c.channel.toLowerCase()}</span>
                  <span className="text-xs text-zinc-500 flex-1">{c.status}</span>
                  <span className="text-[11px] text-zinc-600 shrink-0">{timeAgo(c.lastMessageAt ?? c.createdAt)}</span>
                </Link>
              ); })}
            </div>
          )}
        </section>

        {/* Merge */}
        <section>
          <button onClick={() => setMerging(true)} className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300"><GitMerge className="w-3.5 h-3.5" /> Merge a duplicate into this client</button>
        </section>
      </div>

      {/* Save bar */}
      <div className="p-4 border-t border-zinc-800/60 flex justify-end">
        <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {merging && <MergeDialog orgId={orgId} survivor={p} onClose={() => setMerging(false)} onMerged={() => { setMerging(false); load(); onChanged(); }} />}
    </div>
  );
}

function MergeDialog({ orgId, survivor, onClose, onMerged }: { orgId: string; survivor: CustomerProfile; onClose: () => void; onMerged: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await customersApi.list(orgId, { search: q.trim(), includeLeads: true, limit: 8 });
        setResults((res.data.items ?? []).filter((c: CustomerRow) => c.id !== survivor.id));
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q, orgId, survivor.id]);

  const doMerge = async (absorbed: CustomerRow) => {
    if (!confirm(`Merge "${absorbed.displayName ?? absorbed.primaryEmail ?? 'this client'}" INTO "${survivor.displayName ?? 'this client'}"? The duplicate is deleted and its identifiers/history move here. This cannot be undone.`)) return;
    setBusy(true);
    try { await customersApi.merge(orgId, survivor.id, absorbed.id); toast.success('Merged'); onMerged(); }
    catch { toast.error('Merge failed'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Merge a duplicate</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-zinc-500 mb-3">Find the duplicate person to fold into <span className="text-zinc-300">{survivor.displayName ?? 'this client'}</span>.</p>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone…" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 mb-3" />
        <div className="space-y-1.5 max-h-64 overflow-auto">
          {results.map((c) => (
            <button key={c.id} disabled={busy} onClick={() => doMerge(c)} className="w-full flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left hover:bg-zinc-900 disabled:opacity-50">
              <div className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-300 shrink-0 flex items-center justify-center text-xs font-semibold">{(c.displayName ?? c.primaryEmail ?? '?').charAt(0).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-200 truncate">{c.displayName ?? c.primaryEmail ?? 'Unknown'}</p>
                <p className="text-[11px] text-zinc-600 truncate">{c.primaryEmail ?? c.identifiers.map((i) => ID_META[i.type].label).join(', ')}</p>
              </div>
              <GitMerge className="w-4 h-4 text-zinc-600" />
            </button>
          ))}
          {q.trim() && results.length === 0 && <p className="text-xs text-zinc-600 text-center py-4">No matches.</p>}
        </div>
      </div>
    </div>
  );
}
