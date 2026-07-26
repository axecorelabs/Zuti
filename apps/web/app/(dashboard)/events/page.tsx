'use client';

import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  Plus, Pencil, Trash2, Users, ChevronRight, Download,
  CalendarDays, DollarSign, Tag, CheckCircle, XCircle,
  Clock, RefreshCw, X, AlertCircle, Globe, ImagePlus, Ticket, Copy, ExternalLink, ScanLine,
  Search, RotateCcw, Check,
} from 'lucide-react';
import TicketScanner from './ticket-scanner';
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import { registrationsApi, botsApi, commerceApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useCanManage } from '@/lib/use-role';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'number' | 'select';
  required: boolean;
  options?: string[];
}

interface RegistrationProduct {
  id: string;
  name: string;
  description: string | null;
  eventDate: string | null;
  capacity: number | null;
  isFree: boolean;
  priceMinor: number | null;
  currency: string;
  requiresApproval: boolean;
  allowDuplicateRegistrations: boolean;
  confirmationMessage: string | null;
  fields: ProductField[];
  isActive: boolean;
  botId: string | null;
  isPublic?: boolean;
  slug?: string | null;
  bannerUrl?: string | null;
  flierUrl?: string | null;
  venue?: string | null;
  _count: { entries: number };
  usedSpots?: number;
  createdAt: string;
}

interface TicketType {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  capacity: number | null;
  sortOrder: number;
  isActive: boolean;
  usedSpots?: number;
}

interface RegistrationEntry {
  id: string;
  productId: string;
  customerName: string | null;
  customerEmail: string | null;
  collectedFields: Record<string, string>;
  status: 'PENDING_PAYMENT' | 'AWAITING_APPROVAL' | 'CONFIRMED' | 'CANCELLED';
  quantity?: number;
  amountMinor?: number | null;
  ticketTypeId?: string | null;
  ticketType?: { id: string; name: string } | null;
  paystackReference: string | null;
  paidAt: string | null;
  checkedInAt?: string | null;
  createdAt: string;
}

interface BotOption { id: string; name: string }

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Pending payment',
  AWAITING_APPROVAL: 'Awaiting approval',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING_PAYMENT: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  AWAITING_APPROVAL: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  CONFIRMED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  CANCELLED: 'bg-zinc-800 text-zinc-500 border-zinc-700',
};

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: '#10b981',
  PENDING_PAYMENT: '#f59e0b',
  AWAITING_APPROVAL: '#3b82f6',
  CANCELLED: '#71717a',
};

// ── Stats + charts (shown above the attendees list) ───────────────────────────

function ChartTooltip({ active, payload, label, suffix }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg">
      {label ? <p className="text-zinc-500 mb-0.5">{label}</p> : null}
      <p className="text-white font-medium">
        {p.name ? `${p.name}: ` : ''}{p.value}{suffix ?? ''}
      </p>
    </div>
  );
}

function EventStats({ product, entries }: { product: RegistrationProduct; entries: RegistrationEntry[] }) {
  const qty = (e: RegistrationEntry) => e.quantity ?? 1;
  // Use the amount actually stored on the entry (captures price at registration time); fall back to
  // unit price × quantity for legacy entries with no stored amount.
  const amt = (e: RegistrationEntry) => (e.amountMinor && e.amountMinor > 0 ? e.amountMinor : (product.priceMinor ?? 0) * qty(e));

  const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
  const pending = entries.filter((e) => e.status === 'PENDING_PAYMENT');
  const awaiting = entries.filter((e) => e.status === 'AWAITING_APPROVAL');
  const active = entries.filter((e) => e.status !== 'CANCELLED');

  const revenue = confirmed.reduce((s, e) => s + amt(e), 0) / 100;
  const pendingRevenue = pending.reduce((s, e) => s + amt(e), 0) / 100;
  const ticketsSold = confirmed.reduce((s, e) => s + qty(e), 0);
  const ticketsActive = active.reduce((s, e) => s + qty(e), 0);
  // Check-in: admitted tickets vs the admissible base (confirmed for paid, active for free).
  const admitted = active.filter((e) => e.checkedInAt).reduce((s, e) => s + qty(e), 0);
  const admissionBase = product.isFree ? ticketsActive : ticketsSold;
  const checkinPct = admissionBase > 0 ? Math.round((admitted / admissionBase) * 100) : 0;
  const decided = confirmed.length + pending.length;
  const paidRate = decided > 0 ? Math.round((confirmed.length / decided) * 100) : 0;
  const capacityPct = product.capacity ? Math.min(100, Math.round((ticketsActive / product.capacity) * 100)) : null;
  const money = (n: number) => `${product.currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // Cumulative tickets over time (non-cancelled), one point per registration day.
  const byDay = new Map<string, number>();
  [...active].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).forEach((e) => {
    const d = new Date(e.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDay.set(key, (byDay.get(key) ?? 0) + qty(e));
  });
  let cum = 0;
  const timeData = Array.from(byDay.entries()).map(([key, n]) => {
    cum += n;
    const [y, m, dd] = key.split('-').map(Number);
    return { label: new Date(y, m, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tickets: cum };
  });

  const statusData = [
    { name: 'Confirmed', value: confirmed.length, color: STATUS_COLORS.CONFIRMED },
    { name: 'Pending', value: pending.length, color: STATUS_COLORS.PENDING_PAYMENT },
    { name: 'Awaiting', value: awaiting.length, color: STATUS_COLORS.AWAITING_APPROVAL },
    { name: 'Cancelled', value: entries.length - active.length, color: STATUS_COLORS.CANCELLED },
  ].filter((s) => s.value > 0);

  // Per-ticket-type breakdown (tickets, not rows) — sold = confirmed quantity, held = active quantity.
  const tierMap = new Map<string, { name: string; sold: number; held: number; revenue: number }>();
  for (const e of entries) {
    if (!e.ticketType) continue;
    const cur = tierMap.get(e.ticketType.id) ?? { name: e.ticketType.name, sold: 0, held: 0, revenue: 0 };
    if (e.status === 'CONFIRMED') { cur.sold += qty(e); cur.revenue += amt(e); }
    if (e.status !== 'CANCELLED') cur.held += qty(e);
    tierMap.set(e.ticketType.id, cur);
  }
  const tierStats = Array.from(tierMap.values()).sort((a, b) => b.held - a.held);

  const cards: { label: string; value: string; sub: string }[] = [
    product.isFree
      ? { label: 'Revenue', value: 'Free', sub: 'No charge' }
      : { label: 'Revenue', value: money(revenue), sub: pendingRevenue > 0 ? `${money(pendingRevenue)} pending` : `${ticketsSold} paid ticket${ticketsSold === 1 ? '' : 's'}` },
    { label: product.isFree ? 'Tickets' : 'Tickets sold', value: String(product.isFree ? ticketsActive : ticketsSold), sub: product.capacity ? `${Math.max(0, product.capacity - ticketsActive)} left` : `${entries.length} registrant${entries.length === 1 ? '' : 's'}` },
    { label: 'Registrants', value: String(entries.length), sub: `${confirmed.length} confirmed` },
    product.capacity
      ? { label: 'Capacity filled', value: `${capacityPct}%`, sub: `${ticketsActive}/${product.capacity} spots` }
      : product.isFree
        ? { label: 'Awaiting approval', value: String(awaiting.length), sub: awaiting.length ? 'needs review' : 'all clear' }
        : { label: 'Paid rate', value: `${paidRate}%`, sub: `${pending.length} pending` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="text-[11px] text-zinc-500 font-medium">{c.label}</p>
            <p className="text-lg font-semibold text-white mt-1 tracking-tight truncate">{c.value}</p>
            <p className="text-[11px] text-zinc-600 mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>

      {admissionBase > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs font-medium text-zinc-400">Check-in</p>
            <p className="text-xs text-zinc-500"><span className="text-emerald-400 font-semibold">{admitted}</span> / {admissionBase} admitted · {checkinPct}%</p>
          </div>
          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${checkinPct}%` }} />
          </div>
          {admissionBase > admitted && <p className="text-[11px] text-zinc-600 mt-2">{admissionBase - admitted} yet to arrive</p>}
        </div>
      )}

      {tierStats.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs font-medium text-zinc-400 mb-3">By ticket type</p>
          <div className="space-y-2.5">
            {tierStats.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-300 truncate">{t.name}</span>
                <span className="text-zinc-500 text-xs shrink-0">
                  {product.isFree
                    ? `${t.held} ticket${t.held === 1 ? '' : 's'}`
                    : `${t.sold} sold${t.held > t.sold ? ` · ${t.held - t.sold} pending` : ''}${t.revenue > 0 ? ` · ${money(t.revenue / 100)}` : ''}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs font-medium text-zinc-400 mb-3">Registrations over time</p>
          <ResponsiveContainer width="100%" height={168}>
            <AreaChart data={timeData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="regGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip content={<ChartTooltip suffix=" tickets" />} cursor={{ stroke: '#3f3f46' }} />
              <Area type="monotone" dataKey="tickets" stroke="#818cf8" strokeWidth={2} fill="url(#regGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs font-medium text-zinc-400 mb-3">Status breakdown</p>
          <div className="flex items-center gap-3">
            <div className="w-[140px] h-[168px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} paddingAngle={2} stroke="none">
                    {statusData.map((s) => <Cell key={s.name} fill={s.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5 min-w-0">
              {statusData.map((s) => (
                <div key={s.name} className="flex items-center justify-between text-xs gap-2">
                  <span className="flex items-center gap-2 text-zinc-400 truncate">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </span>
                  <span className="text-zinc-300 font-medium shrink-0">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Live check-in (door) view — scan-first, real-time, search-to-admit ──────────

function CheckInView({ entries, onScan, onToggle, updatingId }: {
  entries: RegistrationEntry[];
  onScan: () => void;
  onToggle: (entryId: string, admit: boolean) => void;
  updatingId: string | null;
}) {
  const [query, setQuery] = useState('');
  const qty = (e: RegistrationEntry) => e.quantity ?? 1;

  // Only confirmed tickets are admissible (free events confirm on registration too).
  const admissible = entries.filter((e) => e.status === 'CONFIRMED');
  const admittedCount = admissible.filter((e) => e.checkedInAt).reduce((s, e) => s + qty(e), 0);
  const totalCount = admissible.reduce((s, e) => s + qty(e), 0);
  const pct = totalCount > 0 ? Math.round((admittedCount / totalCount) * 100) : 0;

  // Per-tier admitted counts.
  const tierMap = new Map<string, { name: string; admitted: number; total: number }>();
  for (const e of admissible) {
    const key = e.ticketType?.id ?? '__none__';
    const cur = tierMap.get(key) ?? { name: e.ticketType?.name ?? 'General', admitted: 0, total: 0 };
    cur.total += qty(e);
    if (e.checkedInAt) cur.admitted += qty(e);
    tierMap.set(key, cur);
  }
  const tiers = Array.from(tierMap.values()).sort((a, b) => b.total - a.total);

  const q = query.trim().toLowerCase();
  const matches = admissible.filter((e) =>
    !q || (e.customerName ?? '').toLowerCase().includes(q) || (e.customerEmail ?? '').toLowerCase().includes(q),
  );
  // Not-yet-arrived first (the queue you're working), then most-recently admitted on top.
  const sorted = [...matches].sort((a, b) => {
    const aIn = a.checkedInAt ? 1 : 0, bIn = b.checkedInAt ? 1 : 0;
    if (aIn !== bIn) return aIn - bIn;
    if (aIn === 1) return +new Date(b.checkedInAt!) - +new Date(a.checkedInAt!);
    return (a.customerName ?? '').localeCompare(b.customerName ?? '');
  });

  return (
    <div className="space-y-5">
      {/* Live progress + scan */}
      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/70 to-zinc-900/30 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-zinc-500 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>
              Live check-in
            </p>
            <p className="text-3xl font-bold text-white mt-1.5 tabular-nums">
              {admittedCount}<span className="text-zinc-600 text-2xl"> / {totalCount}</span>
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">{pct}% admitted{totalCount > admittedCount ? ` · ${totalCount - admittedCount} to arrive` : ' · everyone’s in 🎉'}</p>
          </div>
          <button
            onClick={onScan}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-emerald-950/40"
          >
            <ScanLine className="w-4 h-4" /> Scan tickets
          </button>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden mt-4">
          <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        {tiers.length > 1 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
            {tiers.map((t) => (
              <span key={t.name} className="text-xs text-zinc-500">{t.name} <span className="text-zinc-300 font-medium tabular-nums">{t.admitted}/{t.total}</span></span>
            ))}
          </div>
        )}
      </div>

      {/* Search-to-admit */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name or email to admit manually…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
      </div>

      {/* Attendee list — big tap targets */}
      {sorted.length === 0 ? (
        <div className="text-center py-14 text-zinc-600 text-sm">
          {admissible.length === 0 ? 'No confirmed tickets to check in yet.' : 'No matches.'}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((e) => {
            const inHere = Boolean(e.checkedInAt);
            const busy = updatingId === e.id;
            return (
              <div key={e.id} className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${inHere ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/40'}`}>
                <div className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold ${inHere ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}>
                  {inHere ? <Check className="w-4 h-4" /> : (e.customerName ?? '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-100 truncate font-medium">{e.customerName ?? 'Unnamed'}</p>
                  <p className="text-xs text-zinc-500 truncate">
                    {e.ticketType?.name ? <span className="text-zinc-400">{e.ticketType.name}</span> : null}
                    {e.ticketType?.name && e.customerEmail ? ' · ' : ''}
                    {e.customerEmail ?? ''}
                    {inHere ? <span className="text-emerald-500"> · in at {new Date(e.checkedInAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span> : ''}
                  </p>
                </div>
                {inHere ? (
                  <button
                    onClick={() => onToggle(e.id, false)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors shrink-0"
                    title="Undo check-in"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Undo
                  </button>
                ) : (
                  <button
                    onClick={() => onToggle(e.id, true)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-40 transition-colors shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" /> Check in
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CSV helper ────────────────────────────────────────────────────────────────

function exportCsv(product: RegistrationProduct, entries: RegistrationEntry[]) {
  const fieldKeys = product.fields.map((f) => f.key);
  const headers = ['Name', 'Email', 'Tickets', 'Status', 'Registered at', ...product.fields.map((f) => f.label)];
  const rows = entries.map((e) => [
    e.customerName ?? '',
    e.customerEmail ?? '',
    String(e.quantity ?? 1),
    STATUS_LABEL[e.status] ?? e.status,
    new Date(e.createdAt).toLocaleString(),
    ...fieldKeys.map((k) => e.collectedFields?.[k] ?? ''),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${product.name.replace(/\s+/g, '_')}_registrants.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Field editor sub-component ────────────────────────────────────────────────

function FieldEditor({ fields, onChange }: { fields: ProductField[]; onChange: (f: ProductField[]) => void }) {
  const add = () => onChange([...fields, { key: '', label: '', type: 'text', required: false }]);
  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<ProductField>) =>
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const inputCls = 'w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700 transition-colors';

  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Label (e.g. Company)"
              value={f.label}
              onChange={(e) => {
                const label = e.target.value;
                const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                update(i, { label, key });
              }}
              className={inputCls}
            />
            <select
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as ProductField['type'] })}
              className={inputCls}
            >
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
            </select>
          </div>
          {f.type === 'select' && (
            <input
              placeholder="Comma-separated options: one, two, three"
              value={(f.options ?? []).join(', ')}
              onChange={(e) => update(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
              className={inputCls}
            />
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <button
                type="button"
                onClick={() => update(i, { required: !f.required })}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${f.required ? 'bg-blue-600' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ${f.required ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
              Required
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add field
      </button>
    </div>
  );
}

// ── Shared product form state ──────────────────────────────────────────────────

function useProductForm(existing?: RegistrationProduct) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [eventDate, setEventDate] = useState(
    existing?.eventDate ? existing.eventDate.split('T')[0] : '',
  );
  const [capacity, setCapacity] = useState(existing?.capacity?.toString() ?? '');
  const [requiresApproval, setRequiresApproval] = useState(existing?.requiresApproval ?? false);
  const [allowDuplicateRegistrations, setAllowDuplicateRegistrations] = useState(existing?.allowDuplicateRegistrations ?? false);
  const [confirmationMessage, setConfirmationMessage] = useState(existing?.confirmationMessage ?? '');
  const [fields, setFields] = useState<ProductField[]>(existing?.fields ?? []);
  const [botId, setBotId] = useState(existing?.botId ?? '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [isPublic, setIsPublic] = useState(existing?.isPublic ?? false);
  const [venue, setVenue] = useState(existing?.venue ?? '');
  const [bannerUrl, setBannerUrl] = useState(existing?.bannerUrl ?? '');
  const [flierUrl, setFlierUrl] = useState(existing?.flierUrl ?? '');
  // Ticket tiers drafted during CREATE (UI strings). Seed one row so pricing starts as a tier, not a
  // single "base" price. In edit mode tiers are managed live via the API.
  const [draftTiers, setDraftTiers] = useState<DraftTier[]>(existing ? [] : [{ name: 'General Admission', price: '', capacity: '' }]);

  const buildPayload = (): Record<string, unknown> => ({
    name: name.trim(),
    description: description.trim() || null,
    eventDate: eventDate || null,
    capacity: capacity ? parseInt(capacity, 10) : null,
    currency: 'NGN', // Only Naira is supported for now
    requiresApproval,
    allowDuplicateRegistrations,
    confirmationMessage: confirmationMessage.trim() || null,
    fields: fields.filter((f) => f.key && f.label),
    botId: botId || null,
    isActive,
    isPublic,
    venue: venue.trim() || null,
    bannerUrl: bannerUrl || null,
    flierUrl: flierUrl || null,
  });

  return {
    name, setName, description, setDescription, eventDate, setEventDate,
    capacity, setCapacity,
    requiresApproval, setRequiresApproval, allowDuplicateRegistrations, setAllowDuplicateRegistrations,
    confirmationMessage, setConfirmationMessage,
    fields, setFields, botId, setBotId, isActive, setIsActive,
    isPublic, setIsPublic, venue, setVenue, bannerUrl, setBannerUrl, flierUrl, setFlierUrl,
    draftTiers, setDraftTiers,
    buildPayload,
  };
}

interface DraftTier { name: string; price: string; capacity: string }

// Convert drafted tiers (UI strings) → the API shape. Blank price = free tier, blank capacity = unlimited.
function draftTiersToPayload(draft: DraftTier[]): Array<Record<string, unknown>> {
  return draft
    .filter((t) => t.name.trim())
    .map((t, i) => ({
      name: t.name.trim(),
      priceMinor: t.price ? Math.round(parseFloat(t.price) * 100) : null,
      capacity: t.capacity ? parseInt(t.capacity, 10) : null,
      sortOrder: i,
    }));
}

type ProductFormApi = ReturnType<typeof useProductForm>;

// ── Banner/flier upload (reuses the commerce Supabase image upload → public URL) ─
function EventImageField({ label, orgId, value, onChange }: { label: string; orgId: string; value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await commerceApi.uploadImage(orgId, file);
      onChange((res.data as { url: string }).url);
    } catch { toast.error(`${label} upload failed`); }
    finally { setUploading(false); }
  };
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">{label}</label>
      {value ? (
        <div className="relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="w-full h-24 object-cover rounded-xl border border-zinc-800" />
          {/* Click the image to replace it directly (opens the file picker). */}
          <label className="absolute inset-0 flex items-center justify-center rounded-xl cursor-pointer bg-black/0 group-hover:bg-black/55 text-transparent group-hover:text-white text-xs font-medium transition-colors">
            {uploading ? <RefreshCw className="w-4 h-4 animate-spin text-white" /> : <span className="flex items-center gap-1"><ImagePlus className="w-3.5 h-3.5" /> Replace</span>}
            <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={uploading} />
          </label>
          <button type="button" onClick={() => onChange('')} className="absolute top-1 right-1 z-10 p-1 rounded-lg bg-black/60 text-zinc-300 hover:text-white"><X className="w-3.5 h-3.5" /></button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-1 h-24 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 cursor-pointer hover:border-zinc-600 text-zinc-500 text-xs">
          {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
          <span>{uploading ? 'Uploading…' : `Upload ${label.toLowerCase()}`}</span>
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={uploading} />
        </label>
      )}
    </div>
  );
}

// ── Draft ticket tiers (in-memory, for the CREATE modal — persisted with the event) ──
function TierDraftEditor({ tiers, onChange }: { tiers: DraftTier[]; onChange: (t: DraftTier[]) => void }) {
  const inputCls = 'bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600';
  const add = () => onChange([...tiers, { name: '', price: '', capacity: '' }]);
  const remove = (i: number) => onChange(tiers.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<DraftTier>) => onChange(tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2">
      {tiers.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input className={`${inputCls} flex-1 min-w-[120px]`} placeholder="Tier name (e.g. VIP)" value={t.name} onChange={(e) => update(i, { name: e.target.value })} />
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden w-28">
            <span className="px-2.5 py-2 text-xs text-zinc-500 bg-zinc-950/60 border-r border-zinc-800">₦</span>
            <input className="w-full min-w-0 bg-transparent px-2 py-2 text-sm text-zinc-200 focus:outline-none" type="number" min="0" step="0.01" placeholder="Free" value={t.price} onChange={(e) => update(i, { price: e.target.value })} />
          </div>
          <input className={`${inputCls} w-24`} type="number" min="1" placeholder="Cap" value={t.capacity} onChange={(e) => update(i, { capacity: e.target.value })} />
          <button type="button" onClick={() => remove(i)} className="p-1.5 text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"><Plus className="w-3.5 h-3.5" /> Add ticket tier</button>
    </div>
  );
}

// ── Ticket tiers manager (operates on an existing event via the tier CRUD API) ──
function TicketTypesEditor({ orgId, productId, tiers, loading, onReload }: {
  orgId: string; productId: string; tiers: TicketType[]; loading: boolean; onReload: () => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', priceMinor: '', capacity: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', priceMinor: '', capacity: '' });
  const [saving, setSaving] = useState(false);
  const inputCls = 'bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600';

  const startEdit = (t: TicketType) => {
    setEditId(t.id);
    setEditDraft({
      name: t.name,
      priceMinor: t.priceMinor != null && t.priceMinor > 0 ? String(t.priceMinor / 100) : '',
      capacity: t.capacity != null ? String(t.capacity) : '',
    });
  };
  const saveEdit = async (t: TicketType) => {
    if (!editDraft.name.trim()) { toast.error('Tier name is required'); return; }
    const sold = t.usedSpots ?? 0;
    const nextCap = editDraft.capacity ? parseInt(editDraft.capacity, 10) : null;
    if (nextCap != null && nextCap < sold) { toast.error(`Capacity can't be below ${sold} already sold/reserved`); return; }
    setSaving(true);
    try {
      await registrationsApi.updateTicketType(orgId, t.id, {
        name: editDraft.name.trim(),
        priceMinor: editDraft.priceMinor ? Math.round(parseFloat(editDraft.priceMinor) * 100) : null,
        capacity: nextCap,
      });
      setEditId(null);
      await onReload();
      toast.success('Ticket type updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update ticket type');
    } finally { setSaving(false); }
  };

  const add = async () => {
    if (!draft.name.trim()) { toast.error('Tier name is required'); return; }
    setAdding(true);
    try {
      await registrationsApi.createTicketType(orgId, productId, {
        name: draft.name.trim(),
        priceMinor: draft.priceMinor ? Math.round(parseFloat(draft.priceMinor) * 100) : null,
        capacity: draft.capacity ? parseInt(draft.capacity, 10) : null,
      });
      setDraft({ name: '', priceMinor: '', capacity: '' });
      await onReload();
      toast.success('Ticket type added');
    } catch { toast.error('Failed to add ticket type'); } finally { setAdding(false); }
  };
  const remove = async (id: string) => {
    if (tiers.length <= 1) { toast.error('An event needs at least one ticket type'); return; }
    if (!confirm('Remove this ticket type? Existing tickets keep their record.')) return;
    try { await registrationsApi.deleteTicketType(orgId, id); await onReload(); toast.success('Removed'); }
    catch { toast.error('Failed to remove'); }
  };

  const money = (minor: number | null) => (minor && minor > 0 ? `₦${(minor / 100).toLocaleString()}` : 'Free');

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-600">Every event is priced by its ticket types (a simple event just has one). Price is charged from the type the customer picks. Leave a price blank for a free type.</p>
      {loading ? (
        <div className="h-10 bg-zinc-900 animate-pulse rounded-lg" />
      ) : tiers.length > 0 && (
        <div className="space-y-2">
          {tiers.map((t) => {
            const sold = t.usedSpots ?? 0;
            if (editId === t.id) {
              return (
                <div key={t.id} className="rounded-xl border border-blue-800/60 bg-zinc-950/60 px-3 py-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input className={`${inputCls} flex-1 min-w-[120px]`} placeholder="Tier name" value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} />
                    <input className={`${inputCls} w-24`} type="number" min="0" step="0.01" placeholder="₦ price" value={editDraft.priceMinor} onChange={(e) => setEditDraft((d) => ({ ...d, priceMinor: e.target.value }))} />
                    <input className={`${inputCls} w-24`} type="number" min={sold || 1} placeholder="Capacity" value={editDraft.capacity} onChange={(e) => setEditDraft((d) => ({ ...d, capacity: e.target.value }))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-zinc-500">{sold > 0 ? `${sold} sold/reserved — capacity can't go below this. Blank = unlimited.` : 'Blank capacity = unlimited.'}</p>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setEditId(null)} className="px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
                      <button type="button" onClick={() => saveEdit(t)} disabled={saving} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium">Save</button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
                <Ticket className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200 truncate">{t.name}</p>
                  <p className="text-[11px] text-zinc-500">{money(t.priceMinor)}{t.capacity != null ? ` · ${sold}/${t.capacity} sold` : ` · ${sold} sold · unlimited`}</p>
                </div>
                <button type="button" onClick={() => startEdit(t)} className="p-1.5 text-zinc-500 hover:text-blue-400"><Pencil className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => remove(t.id)} className="p-1.5 text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-2">
        <input className={`${inputCls} flex-1 min-w-[120px]`} placeholder="Tier name (e.g. VIP)" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        <input className={`${inputCls} w-24`} type="number" min="0" step="0.01" placeholder="₦ price" value={draft.priceMinor} onChange={(e) => setDraft((d) => ({ ...d, priceMinor: e.target.value }))} />
        <input className={`${inputCls} w-24`} type="number" min="1" placeholder="Capacity" value={draft.capacity} onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))} />
        <button type="button" onClick={add} disabled={adding} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium"><Plus className="w-3.5 h-3.5" /> Add</button>
      </div>
    </div>
  );
}

// ── Shared field inputs (used by both the create modal and the settings panel) ─

type WizardStep = 'details' | 'tickets' | 'branding' | 'options';

function ProductFormFields({ form, bots, variant, orgId, product, wizardStep }: {
  form: ProductFormApi;
  bots: BotOption[];
  variant: 'compact' | 'sectioned';
  orgId: string;
  product?: RegistrationProduct;
  wizardStep?: WizardStep;
}) {
  const inputCls = 'w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700 transition-colors';
  const labelCls = 'block text-xs text-zinc-400 mb-1.5 font-medium';
  const shareUrl = product?.slug ? `${(process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== 'undefined' ? window.location.origin : ''))}/e/${product.slug}` : '';

  // Load this event's ticket tiers (edit mode only). When any exist, the single price is superseded.
  const [tiers, setTiers] = useState<TicketType[]>([]);
  const [tiersLoading, setTiersLoading] = useState<boolean>(Boolean(product));
  const reloadTiers = useCallback(async () => {
    if (!product) return;
    try { const res = await registrationsApi.listTicketTypes(orgId, product.id); setTiers((res.data as TicketType[]) ?? []); }
    catch { /* ignore */ } finally { setTiersLoading(false); }
  }, [orgId, product]);
  useEffect(() => { reloadTiers(); }, [reloadTiers]);

  // Footgun guard: if every tier is capped and their sum exceeds the overall event cap, the tiers can
  // never fully sell — warn so the organizer notices the contradiction.
  const tierCaps: (number | null)[] = product
    ? tiers.map((t) => t.capacity)
    : form.draftTiers.map((t) => (t.capacity ? Number(t.capacity) : null));
  const allTiersCapped = tierCaps.length > 0 && tierCaps.every((c) => c != null && c > 0);
  const sumTierCap = allTiersCapped ? tierCaps.reduce((s: number, c) => s + (c as number), 0) : null;
  const eventCapNum = form.capacity ? Number(form.capacity) : null;
  const capInconsistent = eventCapNum != null && sumTierCap != null && eventCapNum < sumTierCap;

  const brandingSection = (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Banner & flier</label>
        <p className="text-xs text-zinc-600 mb-2">Shown on the public event page. Banner sits at the top; the flier is a full poster below.</p>
        <div className="grid grid-cols-2 gap-3">
          <EventImageField label="Banner" orgId={orgId} value={form.bannerUrl} onChange={form.setBannerUrl} />
          <EventImageField label="Flier" orgId={orgId} value={form.flierUrl} onChange={form.setFlierUrl} />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
        <div>
          <p className="text-sm text-zinc-300 font-medium">Publish public page</p>
          <p className="text-xs text-zinc-500 mt-0.5">Make a shareable page where anyone can view the event and buy tickets</p>
        </div>
        <button
          type="button"
          onClick={() => form.setIsPublic((v: boolean) => !v)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-4 ${form.isPublic ? 'bg-emerald-600' : 'bg-zinc-700'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.isPublic ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {form.isPublic && shareUrl && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-600/20 bg-emerald-600/5 px-3 py-2">
          <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-xs text-emerald-300 truncate flex-1 font-mono">{shareUrl}</span>
          <button type="button" onClick={() => { navigator.clipboard.writeText(shareUrl).catch(() => {}); toast.success('Link copied'); }} className="p-1 text-zinc-400 hover:text-white" title="Copy link"><Copy className="w-3.5 h-3.5" /></button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-white" title="Open"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
      )}
    </div>
  );

  const generalSection = (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Event name <span className="text-zinc-600">(required)</span></label>
        <input value={form.name} onChange={(e) => form.setName(e.target.value)} placeholder="Annual Conference 2026" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea value={form.description} onChange={(e) => form.setDescription(e.target.value)} rows={2} placeholder="Brief description shown to registrants…" className={`${inputCls} resize-none`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Event date</label>
          <input type="date" value={form.eventDate} onChange={(e) => form.setEventDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Overall capacity <span className="text-zinc-600">(optional)</span></label>
          <input type="number" min="1" value={form.capacity} onChange={(e) => form.setCapacity(e.target.value)} placeholder="e.g. venue limit" className={inputCls} />
        </div>
      </div>
      <p className="text-xs text-zinc-600 -mt-2">Total cap across all ticket types (e.g. a venue limit). Leave blank to let each ticket type&apos;s own quantity define the total.</p>
      {capInconsistent && (
        <p className="text-xs text-amber-400">Your ticket types total {sumTierCap} but the overall cap is {eventCapNum} — you won&apos;t be able to sell more than {eventCapNum}.</p>
      )}
      <div>
        <label className={labelCls}>Venue / location</label>
        <input value={form.venue} onChange={(e) => form.setVenue(e.target.value)} placeholder="e.g. Eko Hotel, Lagos (or a virtual link)" className={inputCls} />
      </div>
    </div>
  );

  const ticketsSection = (
    <div>
      <label className={labelCls}>Ticket types <span className="text-zinc-600">(pricing)</span></label>
      <p className="text-xs text-zinc-600 mb-2">Every event is priced by its ticket types. Add one for a simple event (leave the price blank for free), or several tiers like Regular / VIP — customers pick one when registering.</p>
      <TierDraftEditor tiers={form.draftTiers} onChange={form.setDraftTiers} />
    </div>
  );

  const behaviorSection = (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <div>
            <p className="text-sm text-zinc-300 font-medium">Requires approval</p>
            <p className="text-xs text-zinc-500 mt-0.5">Entries must be manually reviewed before being confirmed</p>
          </div>
          <button
            type="button"
            onClick={() => form.setRequiresApproval((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-4 ${form.requiresApproval ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.requiresApproval ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <div>
            <p className="text-sm text-zinc-300 font-medium">Allow duplicate registrations</p>
            <p className="text-xs text-zinc-500 mt-0.5">When off, each email can hold only one active registration for this event</p>
          </div>
          <button
            type="button"
            onClick={() => form.setAllowDuplicateRegistrations((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-4 ${form.allowDuplicateRegistrations ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.allowDuplicateRegistrations ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <div>
            <p className="text-sm text-zinc-300 font-medium">Active</p>
            <p className="text-xs text-zinc-500 mt-0.5">Inactive events won&apos;t be offered by bots or accept new registrations</p>
          </div>
          <button
            type="button"
            onClick={() => form.setIsActive((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-4 ${form.isActive ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {bots.length > 0 && (
        <div>
          <label className={labelCls}>Link to bot <span className="text-zinc-600">(optional)</span></label>
          <select value={form.botId} onChange={(e) => form.setBotId(e.target.value)} className={inputCls}>
            <option value="">— Any bot —</option>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );

  const messagingSection = (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Custom confirmation message</label>
        <textarea value={form.confirmationMessage} onChange={(e) => form.setConfirmationMessage(e.target.value)} rows={2} placeholder="You're confirmed! See you there." className={`${inputCls} resize-none`} />
      </div>
      <div>
        <label className={`${labelCls} mb-2`}>Custom fields</label>
        <p className="text-xs text-zinc-600 mb-3">Additional info the bot will collect from the customer before registering them.</p>
        <FieldEditor fields={form.fields} onChange={form.setFields} />
      </div>
    </div>
  );

  if (variant === 'compact') {
    // Multi-step wizard (create modal): render only the current step's section(s).
    const stepContent: Record<WizardStep, React.ReactNode> = {
      details: generalSection,
      tickets: ticketsSection,
      branding: brandingSection,
      options: <div className="space-y-6">{behaviorSection}{messagingSection}</div>,
    };
    return <div className="space-y-5">{stepContent[wizardStep ?? 'details']}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="card p-6 border border-zinc-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4 text-zinc-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">General</h2>
            <p className="text-xs text-zinc-500 font-light">Name, description, date and capacity.</p>
          </div>
        </div>
        {generalSection}
      </div>

      <div className="card p-6 border border-zinc-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-zinc-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Bot & behavior</h2>
            <p className="text-xs text-zinc-500 font-light">Which bot offers this event, and approval/visibility rules.</p>
          </div>
        </div>
        {behaviorSection}
      </div>

      <div className="card p-6 border border-zinc-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
            <Pencil className="w-4 h-4 text-zinc-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Confirmation & fields</h2>
            <p className="text-xs text-zinc-500 font-light">What registrants see, and what extra info you collect.</p>
          </div>
        </div>
        {messagingSection}
      </div>

      <div className="card p-6 border border-zinc-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
            <Globe className="w-4 h-4 text-zinc-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Public event page</h2>
            <p className="text-xs text-zinc-500 font-light">A shareable, brandable page for self-serve ticket sales.</p>
          </div>
        </div>
        {brandingSection}
      </div>

      {product && (
        <div className="card p-6 border border-zinc-800">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
              <Ticket className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Ticket types</h2>
              <p className="text-xs text-zinc-500 font-light">Tiers with their own price and capacity (Regular, VIP, …).</p>
            </div>
          </div>
          <TicketTypesEditor orgId={orgId} productId={product.id} tiers={tiers} loading={tiersLoading} onReload={reloadTiers} />
        </div>
      )}
    </div>
  );
}

// ── Create modal (new events only — editing happens inline in the settings tab) ─

interface ProductModalProps {
  orgId: string;
  bots: BotOption[];
  onSaved: () => void;
  onClose: () => void;
}

const WIZARD_STEPS: { key: WizardStep; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'branding', label: 'Branding' },
  { key: 'options', label: 'Options' },
];

function ProductModal({ orgId, bots, onSaved, onClose }: ProductModalProps) {
  const form = useProductForm();
  const [saving, setSaving] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const step = WIZARD_STEPS[stepIdx].key;
  const isLast = stepIdx === WIZARD_STEPS.length - 1;

  const validateStep = (): boolean => {
    if (step === 'details' && !form.name.trim()) { toast.error('Event name is required'); return false; }
    if (step === 'tickets' && draftTiersToPayload(form.draftTiers).length === 0) { toast.error('Add at least one ticket type (leave the price blank for a free type)'); return false; }
    return true;
  };

  const create = async () => {
    if (!form.name.trim()) { setStepIdx(0); toast.error('Event name is required'); return; }
    const tiers = draftTiersToPayload(form.draftTiers);
    if (tiers.length === 0) { setStepIdx(1); toast.error('Add at least one ticket type'); return; }
    const isFree = tiers.every((t) => !t.priceMinor);
    setSaving(true);
    try {
      await registrationsApi.createProduct(orgId, { ...form.buildPayload(), isFree, priceMinor: null, ticketTypes: tiers });
      toast.success('Event created');
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : (Array.isArray(msg) ? msg[0] : 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLast) { void create(); return; }
    if (validateStep()) setStepIdx((i) => i + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center shrink-0">
              <CalendarDays className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Create event</h2>
              <p className="text-xs text-zinc-500">Step {stepIdx + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[stepIdx].label}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step progress */}
        <div className="flex items-center gap-2 px-6 pt-4">
          {WIZARD_STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => { if (i < stepIdx || validateStep()) setStepIdx(i); }}
              className="flex items-center gap-2 flex-1 group"
            >
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-medium border transition-colors ${i < stepIdx ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400' : i === stepIdx ? 'bg-blue-600 border-blue-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-600'}`}>
                {i < stepIdx ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className={`text-xs hidden sm:inline ${i === stepIdx ? 'text-white' : 'text-zinc-600'}`}>{s.label}</span>
              {i < WIZARD_STEPS.length - 1 && <span className="flex-1 h-px bg-zinc-800" />}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="px-6 py-5 space-y-5">
          <div className="min-h-[220px]">
            <ProductFormFields form={form} bots={bots} variant="compact" orgId={orgId} wizardStep={step} />
          </div>

          {/* Footer */}
          <div className="flex gap-2 pt-2 border-t border-zinc-800">
            {stepIdx === 0 ? (
              <button type="button" onClick={onClose} className="flex-1 btn-secondary text-sm py-2.5">Cancel</button>
            ) : (
              <button type="button" onClick={() => setStepIdx((i) => i - 1)} className="flex-1 btn-secondary text-sm py-2.5">Back</button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              {isLast ? (saving ? 'Creating…' : 'Create event') : 'Next'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Event settings tab (inline in the detail panel — replaces the old edit modal) ─

interface EventSettingsTabProps {
  orgId: string;
  bots: BotOption[];
  product: RegistrationProduct;
  onSaved: (updated: RegistrationProduct) => void;
  onDeleted: () => void;
}

function EventSettingsTab({ orgId, bots, product, onSaved, onDeleted }: EventSettingsTabProps) {
  const form = useProductForm(product);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const res = await registrationsApi.updateProduct(orgId, product.id, form.buildPayload());
      toast.success('Event updated');
      onSaved(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : (Array.isArray(msg) ? msg[0] : 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this event? All registrations will also be deleted.')) return;
    setDeleting(true);
    try {
      await registrationsApi.deleteProduct(orgId, product.id);
      toast.success('Event deleted');
      onDeleted();
    } catch {
      toast.error('Failed to delete event');
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <ProductFormFields form={form} bots={bots} variant="sectioned" orgId={orgId} product={product} />

      {/* Save bar */}
      <div className="flex justify-end gap-2 sticky bottom-0 bg-gradient-to-t from-black/40 to-transparent pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Danger zone */}
      <div className="card p-6 border border-red-500/20 bg-red-500/[0.03]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Danger zone</h2>
            <p className="text-xs text-zinc-500 font-light">Deleting an event permanently removes it and all its registrations.</p>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> {deleting ? 'Deleting…' : 'Delete event'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const { activeOrgId } = useAuthStore();
  const canManage = useCanManage(); // OWNER/ADMIN manage; AGENTs get view + check-in only
  const [products, setProducts] = useState<RegistrationProduct[]>([]);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<RegistrationProduct | null>(null);
  const [detailTab, setDetailTab] = useState<'registrants' | 'checkin' | 'settings'>('registrants');
  const [entries, setEntries] = useState<RegistrationEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [updatingEntry, setUpdatingEntry] = useState<string | null>(null);
  const [attendeeSearch, setAttendeeSearch] = useState('');

  const orgId = activeOrgId ?? '';

  // Attendee search (registrants tab) — filter by name, email, or ticket type.
  const attendeeQuery = attendeeSearch.trim().toLowerCase();
  const filteredEntries = attendeeQuery
    ? entries.filter((e) => [e.customerName, e.customerEmail, e.ticketType?.name].some((v) => (v ?? '').toLowerCase().includes(attendeeQuery)))
    : entries;

  const loadProducts = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await registrationsApi.listProducts(orgId);
      setProducts(res.data);
    } catch {
      toast.error('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const loadBots = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await botsApi.list(orgId);
      setBots((res.data as BotOption[]).map((b: BotOption) => ({ id: b.id, name: b.name })));
    } catch { /* ignore */ }
  }, [orgId]);

  const loadEntries = useCallback(async (product: RegistrationProduct) => {
    if (!orgId) return;
    setEntriesLoading(true);
    try {
      const res = await registrationsApi.listEntries(orgId, product.id);
      setEntries(res.data);
    } catch {
      toast.error('Failed to load registrants');
    } finally {
      setEntriesLoading(false);
    }
  }, [orgId]);

  // Live check-in: subscribe to the org's websocket and patch an entry's checkedInAt the moment a
  // ticket is scanned, so the check-in view and column update instantly (no polling).
  useEffect(() => {
    if (!orgId) return;
    const rawUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const apiUrl = /^https?:\/\/.+/.test(rawUrl) ? rawUrl : 'http://localhost:3001';
    const socketUrl = apiUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) return;

    const socket = io(socketUrl, { path: '/ws', transports: ['websocket'], auth: { token } });
    socket.on('connect', () => socket.emit('join', orgId));
    socket.on('registration:checkin', (p: { productId: string; entryId: string; checkedInAt: string | null }) => {
      // Only entries for the event currently loaded will match; others are a no-op. checkedInAt is
      // null on an undo (a manual admission reversed), so the row flips back to not-arrived live.
      setEntries((prev) => prev.map((e) => (e.id === p.entryId ? { ...e, checkedInAt: p.checkedInAt } : e)));
    });
    return () => { socket.disconnect(); };
  }, [orgId]);

  useEffect(() => {
    loadProducts();
    loadBots();
  }, [loadProducts, loadBots]);

  const selectProduct = (p: RegistrationProduct) => {
    // Clicking the already-open event closes its panel; clicking another switches to it.
    if (selectedProduct?.id === p.id) {
      setSelectedProduct(null);
      return;
    }
    setSelectedProduct(p);
    setDetailTab('registrants');
    loadEntries(p);
  };

  const handleSettingsSaved = (updated: RegistrationProduct) => {
    setSelectedProduct(updated);
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleSettingsDeleted = () => {
    setSelectedProduct(null);
    loadProducts();
  };

  const handleEntryStatus = async (entryId: string, status: string) => {
    if (!orgId || !selectedProduct) return;
    setUpdatingEntry(entryId);
    try {
      await registrationsApi.updateEntryStatus(orgId, entryId, status);
      toast.success('Status updated');
      loadEntries(selectedProduct);
    } catch {
      toast.error('Failed to update status');
    } finally {
      setUpdatingEntry(null);
    }
  };

  // Manual door admit / undo from the Check-in list. Optimistically flips the row; the websocket
  // event confirms it (and updates any other open door device).
  const handleManualCheckIn = async (entryId: string, admit: boolean) => {
    if (!orgId) return;
    setUpdatingEntry(entryId);
    const prev = entries;
    setEntries((es) => es.map((e) => (e.id === entryId ? { ...e, checkedInAt: admit ? new Date().toISOString() : null } : e)));
    try {
      const res = await registrationsApi.checkInEntry(orgId, entryId, admit);
      const outcome = res.data?.outcome;
      if (outcome === 'ADMITTED') toast.success('Checked in');
      else if (outcome === 'UNDONE') toast.success('Check-in undone');
      else if (outcome === 'ALREADY_CHECKED_IN') toast('Already checked in');
      else if (outcome === 'NOT_CONFIRMED') { toast.error('Not a confirmed ticket'); setEntries(prev); }
      else { toast.error('Could not update check-in'); setEntries(prev); }
    } catch {
      toast.error('Could not update check-in');
      setEntries(prev);
    } finally {
      setUpdatingEntry(null);
    }
  };

  const onModalSaved = () => {
    setShowModal(false);
    loadProducts();
  };

  const formatPrice = (p: RegistrationProduct) =>
    p.isFree ? 'Free' : `${p.currency} ${((p.priceMinor ?? 0) / 100).toFixed(2)}`;

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="flex h-full">
      {/* Product list */}
      <div className={`flex flex-col ${selectedProduct ? 'hidden md:flex md:w-80 md:border-r md:border-zinc-800/60' : 'flex-1'}`}>
        {/* Header */}
        <div className="p-6 border-b border-zinc-800/60">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-semibold text-white">Events</h1>
            <div className="flex items-center gap-1">
              <button onClick={loadProducts} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              {canManage && (
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> New event
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-500">{canManage ? 'Manage registration events and view sign-ups' : 'View events, attendees and run check-in'}</p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="space-y-1.5">
                      <div className="h-4 w-36 rounded bg-zinc-800 animate-pulse" />
                      <div className="h-3 w-24 rounded bg-zinc-800 animate-pulse" />
                    </div>
                    <div className="h-4 w-4 rounded bg-zinc-800 animate-pulse shrink-0" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-16 rounded bg-zinc-800 animate-pulse" />
                    <div className="h-3 w-12 rounded bg-zinc-800 animate-pulse" />
                    <div className="h-3 w-14 rounded bg-zinc-800 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarDays className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm font-medium text-zinc-400">No events yet</p>
              <p className="text-xs text-zinc-600 mt-1">{canManage ? 'Create your first event to start taking registrations' : 'No events have been set up yet'}</p>
              {canManage && (
                <button
                  onClick={() => setShowModal(true)}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Create event
                </button>
              )}
            </div>
          ) : (
            products.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProduct(p)}
                className={`w-full text-left rounded-xl border p-4 transition-colors group ${
                  selectedProduct?.id === p.id
                    ? 'border-blue-500/40 bg-blue-500/5'
                    : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{p.name}</span>
                      {!p.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">Inactive</span>
                      )}
                    </div>
                    {p.eventDate && (
                      <p className="text-xs text-zinc-500 mt-0.5">{formatDate(p.eventDate)}</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0 mt-0.5" />
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1" title="Tickets (sum of quantities)">
                    <Tag className="w-3 h-3" />
                    {(p.usedSpots ?? p._count.entries)} ticket{(p.usedSpots ?? p._count.entries) !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1" title="Registrants (people)">
                    <Users className="w-3 h-3" />
                    {p._count.entries}
                  </span>
                  {p.capacity && (
                    <span className="flex items-center gap-1">
                      {Math.max(0, p.capacity - (p.usedSpots ?? p._count.entries))} left
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Entry detail panel */}
      {selectedProduct && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Detail header */}
          <div className="p-5 border-b border-zinc-800/60 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors md:hidden"
              >
                <X className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-sm font-semibold text-white">{selectedProduct.name}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {selectedProduct._count.entries} registrant{selectedProduct._count.entries !== 1 ? 's' : ''}
                  {selectedProduct.capacity ? ` · ${selectedProduct.usedSpots ?? selectedProduct._count.entries}/${selectedProduct.capacity} spots` : ''}
                  {selectedProduct.eventDate ? ` · ${formatDate(selectedProduct.eventDate)}` : ''}
                  {' · '}{formatPrice(selectedProduct)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800 mr-1">
                <button
                  onClick={() => setDetailTab('registrants')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    detailTab === 'registrants' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Registrants
                </button>
                <button
                  onClick={() => setDetailTab('checkin')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                    detailTab === 'checkin' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <ScanLine className="w-3.5 h-3.5" /> Check-in
                </button>
                {canManage && (
                  <button
                    onClick={() => setDetailTab('settings')}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                      detailTab === 'settings' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Settings
                  </button>
                )}
              </div>
              {detailTab === 'registrants' && (
                <>
                  <button
                    onClick={() => { loadEntries(selectedProduct); }}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => exportCsv(selectedProduct, entries)}
                    disabled={entries.length === 0}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                </>
              )}
              <div className="w-px h-5 bg-zinc-800 mx-0.5 hidden md:block" />
              <button
                onClick={() => setSelectedProduct(null)}
                title="Close"
                className="hidden md:flex p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-auto p-5">
            {detailTab === 'settings' && canManage ? (
              <EventSettingsTab
                orgId={orgId}
                bots={bots}
                product={selectedProduct}
                onSaved={handleSettingsSaved}
                onDeleted={handleSettingsDeleted}
              />
            ) : detailTab === 'checkin' ? (
              <CheckInView
                entries={entries}
                onScan={() => setShowScanner(true)}
                onToggle={handleManualCheckIn}
                updatingId={updatingEntry}
              />
            ) : entriesLoading ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Name</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Email</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Status</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Registered</th>
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {[...Array(6)].map((_, i) => (
                      <tr key={i}>
                        <td className="py-3 px-3"><div className="h-3.5 w-24 rounded bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-3.5 w-32 rounded bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-5 w-20 rounded-lg bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-3.5 w-16 rounded bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-4 w-4 rounded bg-zinc-800 animate-pulse ml-auto" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users className="w-10 h-10 text-zinc-700 mb-3" />
                <p className="text-sm font-medium text-zinc-400">No registrants yet</p>
                <p className="text-xs text-zinc-600 mt-1">When customers register via a bot they&apos;ll appear here</p>
              </div>
            ) : (
              <div className="space-y-6">
                <EventStats product={selectedProduct} entries={entries} />
                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-xs font-medium text-zinc-500">Attendees{attendeeQuery ? ` · ${filteredEntries.length} of ${entries.length}` : ''}</p>
                    <div className="relative w-56 max-w-[50%]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                      <input
                        value={attendeeSearch}
                        onChange={(e) => setAttendeeSearch(e.target.value)}
                        placeholder="Search name, email, tier…"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Name</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Email</th>
                      {selectedProduct.fields.filter((f) => f.required).map((f) => (
                        <th key={f.key} className="text-left py-2 px-3 text-xs font-medium text-zinc-500">{f.label}</th>
                      ))}
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Ticket type</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Tickets</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Status</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Checked in</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Registered</th>
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {filteredEntries.length === 0 && (
                      <tr><td colSpan={99} className="py-8 text-center text-xs text-zinc-600">No attendees match “{attendeeSearch}”.</td></tr>
                    )}
                    {filteredEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="py-3 px-3 text-zinc-300 font-medium">{entry.customerName ?? '—'}</td>
                        <td className="py-3 px-3 text-zinc-400">{entry.customerEmail ?? '—'}</td>
                        {selectedProduct.fields.filter((f) => f.required).map((f) => (
                          <td key={f.key} className="py-3 px-3 text-zinc-400">
                            {entry.collectedFields?.[f.key] ?? '—'}
                          </td>
                        ))}
                        <td className="py-3 px-3 text-zinc-400">{entry.ticketType?.name ?? '—'}</td>
                        <td className="py-3 px-3 text-zinc-300 font-medium">{entry.quantity ?? 1}</td>
                        <td className="py-3 px-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium border ${STATUS_CLASS[entry.status] ?? 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                            {STATUS_LABEL[entry.status] ?? entry.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {entry.checkedInAt ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400" title={new Date(entry.checkedInAt).toLocaleString()}>
                              <CheckCircle className="w-3 h-3" /> {new Date(entry.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-zinc-500 text-xs whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1 justify-end">
                            {entry.status === 'AWAITING_APPROVAL' && (
                              <>
                                <button
                                  disabled={updatingEntry === entry.id}
                                  onClick={() => handleEntryStatus(entry.id, 'CONFIRMED')}
                                  title="Confirm"
                                  className="p-1 rounded text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button
                                  disabled={updatingEntry === entry.id}
                                  onClick={() => handleEntryStatus(entry.id, 'CANCELLED')}
                                  title="Reject"
                                  className="p-1 rounded text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {entry.status === 'CONFIRMED' && (
                              <button
                                disabled={updatingEntry === entry.id}
                                onClick={() => handleEntryStatus(entry.id, 'CANCELLED')}
                                title="Cancel registration"
                                className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            {entry.status === 'PENDING_PAYMENT' && (
                              <span className="flex items-center gap-1 text-[10px] text-amber-400">
                                <Clock className="w-3 h-3" /> Awaiting payment
                              </span>
                            )}
                            {entry.status === 'CANCELLED' && (
                              <button
                                disabled={updatingEntry === entry.id}
                                onClick={() => handleEntryStatus(entry.id, 'CONFIRMED')}
                                title="Reinstate"
                                className="p-1 rounded text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                              >
                                <AlertCircle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <ProductModal
          orgId={orgId}
          bots={bots}
          onSaved={onModalSaved}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Scan-to-admit panel — scoped to the open event, so other events' tickets are rejected. */}
      <TicketScanner
        orgId={orgId}
        open={showScanner}
        onClose={() => setShowScanner(false)}
        productId={selectedProduct?.id}
        eventName={selectedProduct?.name}
      />
    </div>
  );
}
