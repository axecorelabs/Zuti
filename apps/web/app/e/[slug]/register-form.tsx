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
        <div style={soldOutBox}>This event is sold out.</div>
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
      style={inputStyle}
      type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
      placeholder={f.label + (f.required ? ' *' : '')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Ticket selection with quantity steppers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={labelStyle}>Tickets</label>
        {tiers.map((t) => {
          const soldOut = isSoldOut(t);
          const left = tierEffLeft(t.spotsLeft);
          const qty = quantities[t.id] ?? 0;
          return (
            <div key={t.id}>
              <div style={{ ...tierRow, opacity: soldOut ? 0.5 : 1 }}>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ color: '#f4f4f5', fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                  {t.description && <div style={{ color: '#9ca3af', fontSize: 12 }}>{t.description}</div>}
                  <div style={{ color: '#71717a', fontSize: 12, marginTop: 2 }}>
                    {soldOut ? 'Sold out' : t.isFree ? 'Free' : money(t.priceMinor, t.currency)}
                    {left != null && !soldOut ? ` · ${left <= 5 ? (left === 1 ? 'last one' : `${left} left`) : `${left} left`}` : ''}
                  </div>
                </div>
                {!soldOut && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" onClick={() => setQty(t, qty - 1)} disabled={qty <= 0} style={stepBtn(qty <= 0)}>−</button>
                    <span style={{ minWidth: 18, textAlign: 'center', color: '#f4f4f5', fontWeight: 600 }}>{qty}</span>
                    <button type="button" onClick={() => setQty(t, qty + 1)} style={stepBtn(false)}>+</button>
                  </div>
                )}
                {soldOut && (
                  <button type="button" onClick={() => setWaitlistTierId((cur) => (cur === t.id ? null : t.id))} style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer', background: '#151519', border: `1px solid ${individual ? '#6366f1' : '#26262c'}`, borderRadius: 12, padding: '12px 14px', transition: 'border-color 0.15s' }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', color: '#f4f4f5', fontSize: 13, fontWeight: 600 }}>These tickets are for different people</span>
            <span style={{ display: 'block', color: '#71717a', fontSize: 12, marginTop: 1 }}>Enter each attendee’s details separately</span>
          </span>
          <span style={{ position: 'relative', flexShrink: 0, width: 40, height: 22, borderRadius: 999, background: individual ? '#6366f1' : '#3f3f46', transition: 'background 0.15s' }}>
            <span style={{ position: 'absolute', top: 2, left: individual ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
          </span>
        </button>
      )}

      {/* Shared buyer details — one form applied to every ticket (when NOT entering each attendee) */}
      {!(individual && totalTickets > 1) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={labelStyle}>Your details</label>
          <input style={inputStyle} placeholder="Full name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required />
          <input style={inputStyle} type="email" placeholder="Email address" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required />
          {fields.map((f) => fieldInput(f, buyerFields[f.key] ?? '', (v) => setBuyerFields((p) => ({ ...p, [f.key]: v })), f.key))}
        </div>
      )}

      {/* Per-attendee forms — every ticket filled explicitly, including the buyer's own */}
      {individual && totalTickets > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {slots.map((s, i) => (
            <div key={i} style={{ border: '1px solid #26262c', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ color: '#a5b4fc', fontSize: 12, fontWeight: 600 }}>Ticket {i + 1} · {s.tierName}</div>
                {i === 0 && <div style={{ color: '#71717a', fontSize: 10 }}>payment &amp; receipt contact</div>}
              </div>
              <input style={inputStyle} placeholder="Attendee full name" value={attendees[i]?.name ?? ''} onChange={(e) => patchAttendee(i, { name: e.target.value })} />
              <input style={inputStyle} type="email" placeholder="Attendee email" value={attendees[i]?.email ?? ''} onChange={(e) => patchAttendee(i, { email: e.target.value })} />
              {fields.map((f) => fieldInput(f, attendees[i]?.fields?.[f.key] ?? '', (v) => patchAttendee(i, { fields: { ...(attendees[i]?.fields ?? {}), [f.key]: v } }), `${i}-${f.key}`))}
            </div>
          ))}
        </div>
      )}

      {error && <div style={errorBox}>{error}</div>}

      <button type="submit" disabled={submitting || totalTickets === 0} style={{ ...submitBtn, opacity: submitting || totalTickets === 0 ? 0.6 : 1 }}>
        {submitting ? 'Processing…' : anyPaid ? `Pay ${money(totalMinor, props.currency)}` : `Register ${totalTickets || ''} ticket${totalTickets === 1 ? '' : 's'}`.trim()}
      </button>
      <p style={{ color: '#71717a', fontSize: 11, textAlign: 'center', margin: 0 }}>
        {anyPaid ? 'Secure payment via Paystack. Tickets are issued once payment is confirmed.' : 'You’ll receive your ticket by email.'}
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
      <div style={waitlistJoinedBox}>
        {result.message ?? (result.position ? `You're on the waitlist — position ${result.position}.` : "You're on the waitlist.")}
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      <input style={inputStyle} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={inputStyle} type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {needsTierPick && (
        <select style={inputStyle} value={tierId} onChange={(e) => setTierId(e.target.value)} required>
          <option value="">Which tier?</option>
          {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {error && <div style={errorBox}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...submitBtn, background: '#3f3f46', opacity: submitting ? 0.6 : 1 }}>
        {submitting ? 'Joining…' : 'Join waitlist'}
      </button>
      <p style={{ color: '#71717a', fontSize: 11, textAlign: 'center', margin: 0 }}>We&apos;ll email you the moment a spot opens, with a deadline to claim it.</p>
    </form>
  );
}

const labelStyle: React.CSSProperties = { color: '#9ca3af', fontSize: 12, fontWeight: 500 };
const inputStyle: React.CSSProperties = { background: '#151519', border: '1px solid #26262c', borderRadius: 10, padding: '11px 13px', color: '#f4f4f5', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' };
const tierRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid #26262c', borderRadius: 12, padding: '12px 14px', background: '#151519' };
const stepBtn = (disabled: boolean): React.CSSProperties => ({ width: 30, height: 30, borderRadius: 8, border: '1px solid #3f3f46', background: disabled ? '#1a1a1f' : '#26262c', color: disabled ? '#52525b' : '#f4f4f5', fontSize: 18, lineHeight: 1, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });
const submitBtn: React.CSSProperties = { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 4 };
const errorBox: React.CSSProperties = { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', borderRadius: 10, padding: '10px 12px', fontSize: 13 };
const soldOutBox: React.CSSProperties = { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', borderRadius: 12, padding: '16px', fontSize: 14, textAlign: 'center' };
const waitlistJoinedBox: React.CSSProperties = { background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', borderRadius: 10, padding: '12px 14px', fontSize: 13, textAlign: 'center', marginTop: 10 };
