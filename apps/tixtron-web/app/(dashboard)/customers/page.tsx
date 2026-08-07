'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Search, Mail, Phone, MessageSquare, Send, Globe, Download, Trash2,
  Users, ChevronDown, ShieldCheck, Ban, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { customersApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type Lifecycle = 'LEAD' | 'ENGAGED' | 'CUSTOMER';
type IdType = 'TELEGRAM_CHAT' | 'WHATSAPP_PHONE' | 'EMAIL' | 'PHONE' | 'WIDGET_SESSION';

interface Identifier { id?: string; type: IdType; value?: string; isAnchor: boolean; verifiedAt?: string | null }
interface CustomerRow {
  id: string; displayName: string | null; primaryEmail: string | null; primaryPhone: string | null;
  lifecycleStage: Lifecycle; tags: string[]; emailOptOut: boolean; telegramOptOut: boolean; marketingConsentAt: string | null;
  firstSeenAt: string; lastSeenAt: string;
  identifiers: Identifier[]; _count?: { conversations: number };
}
interface RegistrationEntry { id: string; status: string; amountMinor: number | null; createdAt: string; product: { name: string; currency: string } | null; ticketType: { name: string } | null }
interface CustomerProfile extends CustomerRow {
  identifiers: Identifier[];
  registrationEntries: RegistrationEntry[];
}

const ID_META: Record<IdType, { label: string; icon: any }> = {
  TELEGRAM_CHAT: { label: 'Telegram', icon: Send },
  WHATSAPP_PHONE: { label: 'WhatsApp', icon: MessageSquare },
  EMAIL: { label: 'Email', icon: Mail },
  PHONE: { label: 'Phone', icon: Phone },
  WIDGET_SESSION: { label: 'Web chat', icon: Globe },
};
const STAGE_META: Record<Lifecycle, { label: string; cls: string }> = {
  LEAD: { label: 'Lead', cls: 'bg-zinc-300/40 dark:bg-zinc-700/40 text-zinc-700 dark:text-zinc-300 border-zinc-400/40 dark:border-zinc-600/40' },
  ENGAGED: { label: 'Engaged', cls: 'bg-brand-500/15 text-brand-300 border-brand-500/25' },
  CUSTOMER: { label: 'Customer', cls: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40' },
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

const money = (minor: number | null | undefined, cur = 'NGN') => (minor && minor > 0 ? `${cur} ${(minor / 100).toLocaleString()}` : null);

const PAGE_SIZE = 50;

export default function CustomersPage() {
  const { activeOrgId } = useAuthStore();
  const orgId = activeOrgId ?? '';

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<Lifecycle | 'ALL'>('ALL');

  const fetchPage = useCallback(async (offset: number, limit: number, replace: boolean) => {
    if (!orgId) return;
    if (replace) setLoading(true); else setLoadingMore(true);
    try {
      const res = await customersApi.list(orgId, {
        search: search.trim() || undefined,
        stage: stage === 'ALL' ? undefined : stage,
        includeLeads: stage === 'ALL' ? true : undefined,
        limit,
        offset,
      });
      const items = res.data.items ?? [];
      setRows((prev) => (replace ? items : [...prev, ...items]));
      setTotal(res.data.total ?? 0);
    } catch { toast.error('Failed to load customers'); }
    finally { if (replace) setLoading(false); else setLoadingMore(false); }
  }, [orgId, search, stage]);

  // Fresh page 1 whenever search/stage changes.
  useEffect(() => { const t = setTimeout(() => fetchPage(0, PAGE_SIZE, true), search ? 250 : 0); return () => clearTimeout(t); }, [fetchPage, search]);

  const loadMore = () => fetchPage(rows.length, PAGE_SIZE, false);
  // Re-fetch exactly what's currently visible in place, e.g. after an edit/delete — keeps
  // pagination position instead of collapsing back to page 1.
  const refresh = () => fetchPage(0, Math.max(rows.length, PAGE_SIZE), true);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Customers</h1>
          <span className="text-xs text-zinc-500 dark:text-zinc-500">{total} {total === 1 ? 'person' : 'people'}</span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Everyone who's registered, bought, or messaged your bot. Opt-outs here are honored by the Marketing page.</p>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 dark:text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStage(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                stage === s ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {s === 'ALL' ? 'All' : STAGE_META[s].label + 's'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-zinc-100 dark:bg-zinc-900 animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-6">
          <Users className="w-9 h-9 text-zinc-300 dark:text-zinc-700 mb-3" />
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">No customers{search ? ' match' : ' yet'}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">People who register, buy, or message your bot appear here automatically.</p>
        </div>
      ) : (
        <>
          <div className="card divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {rows.map((c) => <CustomerRowItem key={c.id} orgId={orgId} row={c} onChanged={refresh} />)}
          </div>
          {rows.length < total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-700 disabled:opacity-50 text-xs font-medium transition-colors"
            >
              {loadingMore ? 'Loading…' : `Load more (${rows.length} of ${total})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function CustomerRowItem({ orgId, row, onChanged }: { orgId: string; row: CustomerRow; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !profile) {
      setLoadingProfile(true);
      try {
        const res = await customersApi.get(orgId, row.id);
        setProfile(res.data);
      } catch { toast.error('Failed to load details'); }
      finally { setLoadingProfile(false); }
    }
  };

  const toggleConsent = async (field: 'marketingConsent' | 'telegramOptOut' | 'emailOptOut', value: boolean) => {
    setSavingField(field);
    try {
      await customersApi.update(orgId, row.id, { [field]: value });
      setProfile((p) => p ? {
        ...p,
        marketingConsentAt: field === 'marketingConsent' ? (value ? new Date().toISOString() : null) : p.marketingConsentAt,
        telegramOptOut: field === 'telegramOptOut' ? value : p.telegramOptOut,
        emailOptOut: field === 'emailOptOut' ? value : p.emailOptOut,
      } : p);
      onChanged();
    } catch { toast.error('Failed to save'); }
    finally { setSavingField(null); }
  };

  const exportData = async () => {
    try {
      const res = await customersApi.export(orgId, row.id);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `customer_${row.id}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  const remove = async () => {
    if (!confirm('Delete this customer and all their identity data? Their conversations are kept but unlinked. This cannot be undone.')) return;
    try { await customersApi.remove(orgId, row.id); toast.success('Customer deleted'); onChanged(); }
    catch { toast.error('Delete failed'); }
  };

  const types = [...new Set(row.identifiers.map((i) => i.type))];
  const p = profile ?? row;

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-100/60 dark:hover:bg-zinc-900/60 transition-colors"
      >
        <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shrink-0 flex items-center justify-center text-sm font-semibold">
          {(row.displayName ?? row.primaryEmail ?? '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate font-medium">{row.displayName ?? row.primaryEmail ?? 'Unknown'}</p>
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${STAGE_META[row.lifecycleStage].cls}`}>{STAGE_META[row.lifecycleStage].label}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {types.slice(0, 4).map((t) => { const I = ID_META[t].icon; return <I key={t} className="w-3 h-3 text-zinc-500 dark:text-zinc-500" />; })}
            {row.marketingConsentAt && <span className="text-[10px] text-emerald-500">subscribed</span>}
            {row.telegramOptOut && <span className="text-[10px] text-red-400">opted out</span>}
            <span className="text-[11px] text-zinc-400 dark:text-zinc-600 truncate">· last active {timeAgo(row.lastSeenAt)}</span>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-400 dark:text-zinc-600 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-16 space-y-4">
          {loadingProfile || !profile ? (
            <div className="flex items-center justify-center gap-2 h-20 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 text-xs text-zinc-500 dark:text-zinc-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading details…
            </div>
          ) : (
            <>
              {/* Channels */}
              <div className="space-y-1.5">
                {p.identifiers.map((id, i) => { const M = ID_META[id.type]; const I = M.icon; return (
                  <div key={id.id ?? i} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${id.isAnchor ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40' : 'border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-100/20 dark:bg-zinc-900/20'}`}>
                    <I className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500 shrink-0" />
                    <span className="text-xs text-zinc-500 dark:text-zinc-500 w-20 shrink-0">{M.label}</span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate flex-1">{id.value}</span>
                    {id.isAnchor && <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/70 shrink-0" />}
                  </div>
                ); })}
              </div>

              {/* Consent checklist */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 px-3 py-2 cursor-pointer">
                  <span className="text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500" /> Marketing consent (opt-in)</span>
                  <input type="checkbox" disabled={savingField === 'marketingConsent'} checked={!!(profile as any).marketingConsentAt} onChange={(e) => toggleConsent('marketingConsent', e.target.checked)} className="accent-indigo-500" />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 px-3 py-2 cursor-pointer">
                  <span className="text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2"><Ban className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500" /> Telegram opt-out (no marketing DMs)</span>
                  <input type="checkbox" disabled={savingField === 'telegramOptOut'} checked={!!(profile as any).telegramOptOut} onChange={(e) => toggleConsent('telegramOptOut', e.target.checked)} className="accent-red-500" />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 px-3 py-2 cursor-pointer">
                  <span className="text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2"><Ban className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500" /> Email opt-out (never email)</span>
                  <input type="checkbox" disabled={savingField === 'emailOptOut'} checked={!!(profile as any).emailOptOut} onChange={(e) => toggleConsent('emailOptOut', e.target.checked)} className="accent-red-500" />
                </label>
              </div>

              {/* Tickets & registrations */}
              {profile.registrationEntries?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-500">Tickets &amp; registrations · {profile.registrationEntries.length}</p>
                  {profile.registrationEntries.slice(0, 20).map((r) => (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-zinc-800 dark:text-zinc-200 truncate">{r.product?.name ?? 'Registration'}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-500 truncate">{[r.ticketType?.name, money(r.amountMinor, r.product?.currency)].filter(Boolean).join(' · ')}</p>
                      </div>
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-500 shrink-0">{r.status}</span>
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-600 shrink-0">{timeAgo(r.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button onClick={exportData} className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"><Download className="w-3.5 h-3.5" /> Export</button>
                <button onClick={remove} className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                <span className="text-[11px] text-zinc-300 dark:text-zinc-700">· Merging duplicates is managed in Zuti studio</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
