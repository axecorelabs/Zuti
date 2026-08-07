'use client';

import { FormEvent, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Tier {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  isFree: boolean;
  spotsLeft: number | null;
  soldOut: boolean;
}
interface Field {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}
interface Props {
  slug: string;
  currency: string;
  isFree: boolean;
  priceMinor: number;
  hasTiers: boolean;
  ticketTypes: Tier[];
  fields: Field[];
  soldOut: boolean;
  eventSpotsLeft: number | null;
}

const MAX_PER_ORDER = 50;
function money(minor: number, currency: string) {
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}

type Attendee = { name: string; email: string; fields: Record<string, string> };

const inputCls = 'w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[10px] px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600';
const labelCls = 'text-zinc-500 dark:text-zinc-400 text-xs font-medium';

export default function RegisterForm(props: Props) {
  const { slug, fields } = props;
  const eventLeft = props.eventSpotsLeft;

  // Legacy no-tier events → one synthetic tier from the product price, so the cart UI is uniform.
  const tiers: Tier[] = props.hasTiers
    ? props.ticketTypes
    : [{ id: '__single__', name: 'Ticket', description: null, priceMinor: props.priceMinor, currency: props.currency, isFree: props.isFree, spotsLeft: props.eventSpotsLeft, soldOut: props.soldOut }];

  const tierEffLeft = (tierLeft: number | null): number | null => {
    const m = Math.min(tierLeft ?? Infinity, eventLeft ?? Infinity);
    return m === Infinity ? null : m;
  };
  const isSoldOut = (t: Tier) => t.soldOut || (eventLeft != null && eventLeft <= 0);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerFields, setBuyerFields] = useState<Record<string, string>>({});
  const [individual, setIndividual] = useState(false);
  const [attendees, setAttendees] = useState<Record<number, Partial<Attendee>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitlistTierId, setWaitlistTierId] = useState<string | null>(null); // which sold-out tier row has its join form open

  const totalTickets = Object.values(quantities).reduce((s, n) => s + n, 0);
  const totalMinor = tiers.reduce((s, t) => s + (quantities[t.id] ?? 0) * (t.priceMinor || 0), 0);
  const anyPaid = totalMinor > 0;

  if (props.soldOut || tiers.every(isSoldOut)) {
    return (
      <div>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300 rounded-xl p-4 text-sm text-center">This event is sold out.</div>
        <WaitlistJoinForm slug={slug} tiers={tiers} fixedTierId={props.hasTiers ? undefined : tiers[0]?.id} />
      </div>
    );
  }

  // Flattened ticket slots (for per-attendee entry), in tier order.
  const slots: { tierId: string; tierName: string }[] = [];
  for (const t of tiers) for (let i = 0; i < (quantities[t.id] ?? 0); i++) slots.push({ tierId: t.id, tierName: t.name });

  const setQty = (t: Tier, next: number) => {
    // Cap by the tier's own remaining AND the event's remaining across everything already picked.
    const others = totalTickets - (quantities[t.id] ?? 0);
    const eventRoom = eventLeft != null ? Math.max(0, eventLeft - others) : Infinity;
    const cap = Math.min(tierEffLeft(t.spotsLeft) ?? MAX_PER_ORDER, eventRoom, MAX_PER_ORDER);
    setQuantities((q) => ({ ...q, [t.id]: Math.max(0, Math.min(cap, next)) }));
  };
  const patchAttendee = (i: number, patch: Partial<Attendee>) =>
    setAttendees((prev) => ({ ...prev, [i]: { ...prev[i], ...patch } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (totalTickets === 0) { setError('Select at least one ticket.'); return; }
    const perAttendee = individual && totalTickets > 1;
    // Payer / contact for the payment + receipt: the buyer block when shared, else the first ticket.
    const payerName = perAttendee ? (attendees[0]?.name ?? '') : buyerName;
    const payerEmail = perAttendee ? (attendees[0]?.email ?? '') : buyerEmail;
    if (perAttendee) {
      for (let i = 0; i < slots.length; i++) {
        if (!attendees[i]?.name?.trim() || !attendees[i]?.email?.trim()) { setError(`Fill in the name and email for ticket ${i + 1}.`); return; }
      }
    } else if (!buyerEmail.trim()) { setError('Your email is required.'); return; }
    setSubmitting(true);
    try {
      const items = tiers
        .filter((t) => (quantities[t.id] ?? 0) > 0)
        .map((t) => {
          const slotIdxs = slots.map((s, i) => (s.tierId === t.id ? i : -1)).filter((i) => i >= 0);
          const att = slotIdxs.map((i) => {
            if (perAttendee) {
              const a = attendees[i] ?? {};
              return { name: a.name || undefined, email: a.email || undefined, fields: a.fields ?? {} };
            }
            return { name: buyerName || undefined, email: buyerEmail || undefined, fields: { ...buyerFields } };
          });
          return { ...(props.hasTiers ? { ticketTypeId: t.id } : {}), quantity: quantities[t.id], attendees: att };
        });

      const res = await fetch(`${API_URL}/api/public/events/${slug}/register-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: payerName || undefined, customerEmail: payerEmail, items }),
      });
      const data = await res.json();
      if (!res.ok) { setError(typeof data?.message === 'string' ? data.message : 'Could not complete registration.'); setSubmitting(false); return; }
      if (data.paymentUrl) { window.location.href = data.paymentUrl; return; } // → Paystack
      if (data.tickets?.[0]?.ticketUrl) { window.location.href = data.tickets[0].ticketUrl; return; } // free → ticket
      setError('Could not complete registration. Please try again.'); setSubmitting(false);
    } catch {
      setError('Something went wrong. Please try again.'); setSubmitting(false);
    }
  };

  const fieldInput = (f: Field, value: string, onChange: (v: string) => void, key?: string) => (
    <input
      key={key}
      className={inputCls}
      type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
      placeholder={f.label + (f.required ? ' *' : '')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      {/* Ticket selection with quantity steppers */}
      <div className="flex flex-col gap-2">
        <label className={labelCls}>Tickets</label>
        {tiers.map((t) => {
          const soldOut = isSoldOut(t);
          const left = tierEffLeft(t.spotsLeft);
          const qty = quantities[t.id] ?? 0;
          return (
            <div key={t.id}>
              <div className={`flex items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-3 bg-zinc-50 dark:bg-zinc-900 ${soldOut ? 'opacity-50' : ''}`}>
                <div className="text-left min-w-0">
                  <div className="text-zinc-900 dark:text-zinc-100 font-semibold text-sm">{t.name}</div>
                  {t.description && <div className="text-zinc-500 dark:text-zinc-400 text-xs">{t.description}</div>}
                  <div className="text-zinc-500 text-xs mt-0.5 tabular-nums">
                    {soldOut ? 'Sold out' : t.isFree ? 'Free' : money(t.priceMinor, t.currency)}
                    {left != null && !soldOut ? ` · ${left <= 5 ? (left === 1 ? 'last one' : `${left} left`) : `${left} left`}` : ''}
                  </div>
                </div>
                {!soldOut && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => setQty(t, qty - 1)} disabled={qty <= 0} className={`w-[30px] h-[30px] rounded-lg border border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-lg leading-none ${qty <= 0 ? 'bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 cursor-not-allowed' : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}>−</button>
                    <span className="min-w-[18px] text-center text-zinc-900 dark:text-zinc-100 font-semibold tabular-nums">{qty}</span>
                    <button type="button" onClick={() => setQty(t, qty + 1)} className="w-[30px] h-[30px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-center text-lg leading-none">+</button>
                  </div>
                )}
                {soldOut && (
                  <button type="button" onClick={() => setWaitlistTierId((cur) => (cur === t.id ? null : t.id))} className="bg-transparent border-none text-brand-600 dark:text-brand-400 text-xs font-semibold whitespace-nowrap hover:text-brand-500 dark:hover:text-brand-300">
                    {waitlistTierId === t.id ? 'Cancel' : 'Join waitlist'}
                  </button>
                )}
              </div>
              {soldOut && waitlistTierId === t.id && <WaitlistJoinForm slug={slug} tiers={tiers} fixedTierId={t.id} />}
            </div>
          );
        })}
      </div>

      {/* Per-attendee option — sits above the details so the choice drives which form shows */}
      {totalTickets > 1 && (
        <button
          type="button"
          role="switch"
          aria-checked={individual}
          onClick={() => setIndividual((v) => !v)}
          className={`flex items-center justify-between gap-3 w-full text-left rounded-xl px-3.5 py-3 bg-zinc-50 dark:bg-zinc-900 border transition-colors ${individual ? 'border-brand-600' : 'border-zinc-200 dark:border-zinc-800'}`}
        >
          <span className="min-w-0">
            <span className="block text-zinc-900 dark:text-zinc-100 text-[13px] font-semibold">These tickets are for different people</span>
            <span className="block text-zinc-500 text-xs mt-0.5">Enter each attendee&apos;s details separately</span>
          </span>
          <span className={`relative shrink-0 w-10 h-[22px] rounded-full transition-colors ${individual ? 'bg-brand-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
            <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${individual ? 'left-5' : 'left-0.5'}`} />
          </span>
        </button>
      )}

      {/* Shared buyer details — one form applied to every ticket (when NOT entering each attendee) */}
      {!(individual && totalTickets > 1) && (
        <div className="flex flex-col gap-2">
          <label className={labelCls}>Your details</label>
          <input className={inputCls} placeholder="Full name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required />
          <input className={inputCls} type="email" placeholder="Email address" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required />
          {fields.map((f) => fieldInput(f, buyerFields[f.key] ?? '', (v) => setBuyerFields((p) => ({ ...p, [f.key]: v })), f.key))}
        </div>
      )}

      {/* Per-attendee forms — every ticket filled explicitly, including the buyer's own */}
      {individual && totalTickets > 1 && (
        <div className="flex flex-col gap-3">
          {slots.map((s, i) => (
            <div key={i} className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-brand-600 dark:text-brand-400 text-xs font-semibold">Ticket {i + 1} · {s.tierName}</div>
                {i === 0 && <div className="text-zinc-500 text-[10px]">payment &amp; receipt contact</div>}
              </div>
              <input className={inputCls} placeholder="Attendee full name" value={attendees[i]?.name ?? ''} onChange={(e) => patchAttendee(i, { name: e.target.value })} />
              <input className={inputCls} type="email" placeholder="Attendee email" value={attendees[i]?.email ?? ''} onChange={(e) => patchAttendee(i, { email: e.target.value })} />
              {fields.map((f) => fieldInput(f, attendees[i]?.fields?.[f.key] ?? '', (v) => patchAttendee(i, { fields: { ...(attendees[i]?.fields ?? {}), [f.key]: v } }), `${i}-${f.key}`))}
            </div>
          ))}
        </div>
      )}

      {error && <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300 rounded-[10px] px-3 py-2.5 text-sm">{error}</div>}

      <button type="submit" disabled={submitting || totalTickets === 0} className="bg-brand-600 hover:bg-brand-500 text-white rounded-[10px] py-3.5 text-[15px] font-semibold mt-1 disabled:opacity-60 transition-colors">
        {submitting ? 'Processing…' : anyPaid ? `Pay ${money(totalMinor, props.currency)}` : `Register ${totalTickets || ''} ticket${totalTickets === 1 ? '' : 's'}`.trim()}
      </button>
      <p className="text-zinc-500 text-[11px] text-center">
        {anyPaid ? 'Secure payment via Paystack. Tickets are issued once payment is confirmed.' : "You'll receive your ticket by email."}
      </p>
    </form>
  );
}

function WaitlistJoinForm({ slug, tiers, fixedTierId }: { slug: string; tiers: Tier[]; fixedTierId?: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tierId, setTierId] = useState(fixedTierId ?? (tiers.length === 1 ? tiers[0].id : ''));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ outcome: string; position?: number; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsTierPick = !fixedTierId && tiers.length > 1;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError('Email is required.'); return; }
    if (needsTierPick && !tierId) { setError('Choose a ticket tier.'); return; }
    setSubmitting(true);
    try {
      const chosenTierId = tierId === '__single__' ? undefined : tierId || undefined;
      const res = await fetch(`${API_URL}/api/public/events/${slug}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: name.trim() || undefined, customerEmail: email.trim(), ticketTypeId: chosenTierId }),
      });
      const data = await res.json();
      if (!res.ok || data?.outcome === 'PRODUCT_NOT_FOUND' || data?.outcome === 'MISSING_FIELDS') {
        setError(data?.message ?? 'Could not join the waitlist.');
        setSubmitting(false);
        return;
      }
      setResult(data);
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  if (result && (result.outcome === 'JOINED' || result.outcome === 'ALREADY_WAITING')) {
    return (
      <div className="bg-brand-600/[0.06] dark:bg-brand-600/10 border border-brand-600/20 dark:border-brand-600/30 text-brand-700 dark:text-brand-300 rounded-[10px] px-3.5 py-3 text-[13px] text-center mt-2.5">
        {result.message ?? (result.position ? `You're on the waitlist — position ${result.position}.` : "You're on the waitlist.")}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 mt-2.5">
      <input className={inputCls} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className={inputCls} type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {needsTierPick && (
        <select className={inputCls} value={tierId} onChange={(e) => setTierId(e.target.value)} required>
          <option value="">Which tier?</option>
          {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {error && <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300 rounded-[10px] px-3 py-2.5 text-sm">{error}</div>}
      <button type="submit" disabled={submitting} className="bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white rounded-[10px] py-3.5 text-[15px] font-semibold mt-1 disabled:opacity-60 transition-colors">
        {submitting ? 'Joining…' : 'Join waitlist'}
      </button>
      <p className="text-zinc-500 text-[11px] text-center">We&apos;ll email you the moment a spot opens, with a deadline to claim it.</p>
    </form>
  );
}
