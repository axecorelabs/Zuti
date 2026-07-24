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
}

function money(minor: number, currency: string) {
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}

export default function RegisterForm(props: Props) {
  const { slug, hasTiers, ticketTypes, fields } = props;
  const buyableTiers = ticketTypes.filter((t) => !t.soldOut);
  const [ticketTypeId, setTicketTypeId] = useState(buyableTiers[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTier = ticketTypes.find((t) => t.id === ticketTypeId);
  const unitMinor = hasTiers ? (selectedTier?.priceMinor ?? 0) : props.priceMinor;
  const free = hasTiers ? (selectedTier?.isFree ?? false) : props.isFree;
  const totalMinor = unitMinor * quantity;

  if (props.soldOut || (hasTiers && buyableTiers.length === 0)) {
    return <div style={soldOutBox}>This event is sold out.</div>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/public/events/${slug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name || undefined,
          customerEmail: email,
          ticketTypeId: hasTiers ? ticketTypeId : undefined,
          quantity,
          fields: custom,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.message === 'string' ? data.message : 'Could not complete registration.');
        setSubmitting(false);
        return;
      }
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl; // → Paystack checkout
        return;
      }
      if (data.ticketUrl) {
        window.location.href = data.ticketUrl; // free/confirmed/already-registered → ticket page
        return;
      }
      if (data.outcome === 'AT_CAPACITY') {
        setError(data.spotsLeft > 0 ? `Only ${data.spotsLeft} spot(s) left — try a smaller quantity.` : 'This event is sold out.');
      } else {
        setError('Could not complete registration. Please try again.');
      }
      setSubmitting(false);
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {hasTiers && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={labelStyle}>Select ticket</label>
          {ticketTypes.map((t) => {
            const active = t.id === ticketTypeId;
            return (
              <button
                key={t.id}
                type="button"
                disabled={t.soldOut}
                onClick={() => setTicketTypeId(t.id)}
                style={{
                  ...tierRow,
                  borderColor: active ? '#6366f1' : '#26262c',
                  background: active ? 'rgba(99,102,241,0.08)' : '#151519',
                  opacity: t.soldOut ? 0.5 : 1,
                  cursor: t.soldOut ? 'not-allowed' : 'pointer',
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: '#f4f4f5', fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                  {t.description && <div style={{ color: '#9ca3af', fontSize: 12 }}>{t.description}</div>}
                  {t.spotsLeft != null && !t.soldOut && <div style={{ color: '#71717a', fontSize: 11, marginTop: 2 }}>{t.spotsLeft} left</div>}
                </div>
                <div style={{ color: '#f4f4f5', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>
                  {t.soldOut ? 'Sold out' : t.isFree ? 'Free' : money(t.priceMinor, t.currency)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={labelStyle}>Quantity</label>
        <input type="number" min={1} max={50} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} style={inputStyle} />
      </div>

      <input style={inputStyle} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input style={inputStyle} type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />

      {fields.map((f) => (
        <input
          key={f.key}
          style={inputStyle}
          type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
          placeholder={f.label + (f.required ? ' *' : '')}
          required={f.required}
          value={custom[f.key] ?? ''}
          onChange={(e) => setCustom((prev) => ({ ...prev, [f.key]: e.target.value }))}
        />
      ))}

      {error && <div style={errorBox}>{error}</div>}

      <button type="submit" disabled={submitting || (hasTiers && !ticketTypeId)} style={submitBtn}>
        {submitting ? 'Processing…' : free ? 'Register' : `Pay ${money(totalMinor, props.currency)}`}
      </button>
      <p style={{ color: '#71717a', fontSize: 11, textAlign: 'center', margin: 0 }}>
        {free ? 'You’ll receive your ticket by email.' : 'Secure payment via Paystack. Your ticket is issued once payment is confirmed.'}
      </p>
    </form>
  );
}

const labelStyle: React.CSSProperties = { color: '#9ca3af', fontSize: 12, fontWeight: 500 };
const inputStyle: React.CSSProperties = { background: '#151519', border: '1px solid #26262c', borderRadius: 10, padding: '11px 13px', color: '#f4f4f5', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' };
const tierRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid', borderRadius: 12, padding: '12px 14px' };
const submitBtn: React.CSSProperties = { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 4 };
const errorBox: React.CSSProperties = { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', borderRadius: 10, padding: '10px 12px', fontSize: 13 };
const soldOutBox: React.CSSProperties = { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', borderRadius: 12, padding: '16px', fontSize: 14, textAlign: 'center' };
