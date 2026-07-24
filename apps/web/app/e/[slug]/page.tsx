import type { Metadata } from 'next';
import { CalendarDays, MapPin } from 'lucide-react';
import RegisterForm from './register-form';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Tier {
  id: string; name: string; description: string | null; priceMinor: number;
  currency: string; isFree: boolean; spotsLeft: number | null; soldOut: boolean;
}
interface EventData {
  slug: string; name: string; description: string | null; eventDate: string | null;
  venue: string | null; bannerUrl: string | null; flierUrl: string | null;
  currency: string; isFree: boolean; priceMinor: number; requiresApproval: boolean;
  fields: Array<{ key: string; label: string; type: string; required: boolean; options?: string[] }>;
  hasTiers: boolean; ticketTypes: Tier[]; capacity: number | null; spotsLeft: number | null; soldOut: boolean;
}

async function getEvent(slug: string): Promise<EventData | null> {
  try {
    const res = await fetch(`${API_URL}/api/public/events/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const ev = await getEvent(slug);
  if (!ev) return { title: 'Event not found' };
  return {
    title: ev.name,
    description: ev.description ?? `Register for ${ev.name}`,
    openGraph: {
      title: ev.name,
      description: ev.description ?? `Register for ${ev.name}`,
      images: ev.bannerUrl ? [{ url: ev.bannerUrl }] : ev.flierUrl ? [{ url: ev.flierUrl }] : [],
    },
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await getEvent(slug);

  if (!ev) {
    return (
      <div style={pageWrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>Event not found</p>
          <p style={{ fontSize: 13, color: '#71717a', margin: '8px 0 0' }}>This link may be invalid or the event is no longer public.</p>
        </div>
      </div>
    );
  }

  const eventDate = ev.eventDate
    ? new Date(ev.eventDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div style={pageWrap}>
      <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ev.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ev.bannerUrl} alt={ev.name} style={{ width: '100%', borderRadius: 16, border: '1px solid #26262c', objectFit: 'cover', maxHeight: 260 }} />
        )}

        <div style={card}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 0 10px', lineHeight: 1.2 }}>{ev.name}</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: ev.description ? 16 : 0 }}>
            {eventDate && (
              <div style={metaRow}><CalendarDays style={metaIcon} /> {eventDate}</div>
            )}
            {ev.venue && (
              <div style={metaRow}><MapPin style={metaIcon} /> {ev.venue}</div>
            )}
          </div>
          {ev.description && <p style={{ color: '#d4d4d8', fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{ev.description}</p>}
        </div>

        {ev.flierUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ev.flierUrl} alt={`${ev.name} flier`} style={{ width: '100%', borderRadius: 16, border: '1px solid #26262c' }} />
        )}

        <div style={card}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f5', margin: '0 0 14px' }}>Get your ticket</h2>
          <RegisterForm
            slug={ev.slug}
            currency={ev.currency}
            isFree={ev.isFree}
            priceMinor={ev.priceMinor}
            hasTiers={ev.hasTiers}
            ticketTypes={ev.ticketTypes}
            fields={ev.fields}
            soldOut={ev.soldOut}
          />
        </div>

        <p style={{ color: '#52525b', fontSize: 11, textAlign: 'center', margin: '4px 0 0' }}>Powered by Zuti</p>
      </div>
    </div>
  );
}

const pageWrap: React.CSSProperties = { minHeight: '100vh', background: '#0b0b0e', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '32px 16px 64px' };
const card: React.CSSProperties = { background: '#121216', border: '1px solid #26262c', borderRadius: 16, padding: 24 };
const metaRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, color: '#a1a1aa', fontSize: 13 };
const metaIcon: React.CSSProperties = { width: 15, height: 15, color: '#818cf8' };
