import type { Metadata } from 'next';
import { CalendarDays, MapPin } from 'lucide-react';
import RegisterForm from './register-form';
import EventDescription from './description';

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
      <div style={{ minHeight: '100vh', background: '#0b0b0e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily }}>
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

  const meta = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
      {eventDate && <span style={metaRow}><CalendarDays style={metaIcon} /> {eventDate}</span>}
      {ev.venue && <span style={metaRow}><MapPin style={metaIcon} /> {ev.venue}</span>}
    </div>
  );

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0b0b0e', fontFamily }}>
      {/* Fixed, blurred flier as the page backdrop. We blur the IMAGE layer (filter: blur), not a
          backdrop-filter, so it works in every browser; scale(1.2) hides the blurred transparent
          edges. A dark layer on top keeps foreground text legible. */}
      {ev.flierUrl && (
        <div
          aria-hidden
          style={{
            position: 'fixed', inset: 0, zIndex: 0,
            backgroundImage: `url("${ev.flierUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'blur(30px)', transform: 'scale(1.2)',
          }}
        />
      )}
      <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 0, background: ev.flierUrl ? 'rgba(8,8,11,0.80)' : '#0b0b0e' }} />

      {/* Foreground */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {ev.bannerUrl ? (
          <div style={{ position: 'relative', width: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ev.bannerUrl} alt={ev.name} style={{ width: '100%', height: 'min(52vh, 460px)', objectFit: 'cover', display: 'block' }} />
            <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(8,8,11,0.95) 0%, rgba(8,8,11,0.45) 40%, rgba(8,8,11,0) 75%)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
              <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 20px 28px' }}>
                <h1 style={titleStyle}>{ev.name}</h1>
                {meta}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '56px 20px 0' }}>
            <h1 style={titleStyle}>{ev.name}</h1>
            {meta}
          </div>
        )}

        <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 20px 72px' }}>
          {ev.description && (
            <div style={{ marginBottom: 28 }}>
              <EventDescription text={ev.description} />
            </div>
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

          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, textAlign: 'center', margin: '20px 0 0' }}>Powered by Zuti</p>
        </div>
      </div>
    </div>
  );
}

const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const card: React.CSSProperties = { background: 'rgba(18,18,22,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24 };
const titleStyle: React.CSSProperties = { fontSize: 'clamp(26px, 6vw, 40px)', fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.15, letterSpacing: '-0.5px', textShadow: '0 2px 20px rgba(0,0,0,0.5)' };
const metaRow: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, color: 'rgba(255,255,255,0.85)', fontSize: 14, textShadow: '0 1px 8px rgba(0,0,0,0.4)' };
const metaIcon: React.CSSProperties = { width: 15, height: 15, color: '#a5b4fc' };
