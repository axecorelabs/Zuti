import type { Metadata } from 'next';
import { CalendarDays, MapPin, Building2 } from 'lucide-react';
import RegisterForm from './register-form';
import EventDescription from './description';
import ShareButton from './share-button';

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
  organizerName: string | null;
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

function InfoRow({ icon: Icon, title, subtitle }: { icon: typeof CalendarDays; title: string; subtitle?: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: 'rgba(129,140,248,0.14)', border: '1px solid rgba(129,140,248,0.20)', flexShrink: 0 }}>
        <Icon style={{ width: 19, height: 19, color: '#a5b4fc' }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f5', margin: 0, lineHeight: 1.35 }}>{title}</p>
        {subtitle && <p style={{ fontSize: 13, color: '#8b8b94', margin: '2px 0 0', lineHeight: 1.4 }}>{subtitle}</p>}
      </div>
    </div>
  );
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await getEvent(slug);

  if (!ev) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily }}>
        <div style={{ ...sheet, textAlign: 'center', maxWidth: 380, padding: 32 }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>Event not found</p>
          <p style={{ fontSize: 13, color: '#71717a', margin: '8px 0 0' }}>This link may be invalid or the event is no longer public.</p>
        </div>
      </div>
    );
  }

  const eventDate = ev.eventDate
    ? new Date(ev.eventDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // Cheapest ticket → the "from" price on the sticky bar.
  const tierPrices = ev.hasTiers ? ev.ticketTypes.map((t) => t.priceMinor) : [ev.priceMinor];
  const minMinor = Math.min(...tierPrices);
  const allFree = ev.hasTiers ? ev.ticketTypes.every((t) => t.isFree) : ev.isFree;
  const multiPriced = ev.hasTiers && ev.ticketTypes.length > 1 && !allFree;
  const priceLabel = allFree ? 'Free' : `${ev.currency} ${(minMinor / 100).toLocaleString()}`;
  const heroImg = ev.bannerUrl ?? ev.flierUrl;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0e', fontFamily }}>
      <div className="mx-auto w-full max-w-5xl pb-28 lg:pb-14">
        {/* Hero */}
        <div className="relative">
          {heroImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroImg} alt={ev.name} className="block w-full object-cover" style={{ height: 'min(44vh, 420px)' }} />
          ) : (
            <div className="w-full" style={{ height: 200, background: 'linear-gradient(135deg, #4338ca, #6d28d9)' }} />
          )}
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(10,10,14,1) 0%, rgba(10,10,14,0.30) 45%, rgba(10,10,14,0.12) 100%)' }} />
          <div className="absolute top-4 right-4 sm:top-5 sm:right-5">
            <ShareButton title={ev.name} />
          </div>
          <div className="absolute inset-x-0 bottom-0">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pb-5 lg:pb-8">
              <h1 style={titleStyle}>{ev.name}</h1>
              {ev.venue && <p className="mt-2" style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 8px rgba(0,0,0,0.5)' }}>{ev.venue}</p>}
            </div>
          </div>
        </div>

        {/* Body — two columns on desktop (details | sticky register), one column on mobile */}
        <div className="px-4 sm:px-6 lg:px-8 pt-6 lg:pt-9 lg:grid lg:grid-cols-[1fr_360px] lg:gap-9 lg:items-start">
          {/* Left: details */}
          <div className="min-w-0 space-y-7">
            <div style={sheet} className="p-5 flex flex-col gap-4">
              {eventDate && <InfoRow icon={CalendarDays} title={eventDate} />}
              {ev.venue && <InfoRow icon={MapPin} title={ev.venue} subtitle="Location" />}
              {ev.organizerName && <InfoRow icon={Building2} title={ev.organizerName} subtitle="Organizer" />}
            </div>

            {ev.description && (
              <div>
                <h2 style={sectionHeading}>About this event</h2>
                <EventDescription text={ev.description} />
              </div>
            )}
          </div>

          {/* Right: register card (sticky on desktop; sits below the details on mobile) */}
          <div id="register" className="mt-8 lg:mt-0 lg:sticky lg:top-6 scroll-mt-6" style={sheet}>
            <div className="p-5">
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  {!allFree && <p style={{ fontSize: 11, color: '#8b8b94', margin: 0 }}>{multiPriced ? 'From' : 'Price'}</p>}
                  <p style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.15 }}>
                    {priceLabel}{!allFree && <span style={{ fontSize: 12, fontWeight: 500, color: '#8b8b94' }}> /ticket</span>}
                  </p>
                </div>
              </div>
              <RegisterForm
                slug={ev.slug}
                currency={ev.currency}
                isFree={ev.isFree}
                priceMinor={ev.priceMinor}
                hasTiers={ev.hasTiers}
                ticketTypes={ev.ticketTypes}
                fields={ev.fields}
                soldOut={ev.soldOut}
                eventSpotsLeft={ev.spotsLeft}
              />
            </div>
          </div>
        </div>

        <p className="text-center" style={{ color: 'rgba(255,255,255,0.32)', fontSize: 11, marginTop: 28 }}>Powered by Zuti</p>
      </div>

      {/* Mobile-only sticky bottom bar (desktop shows the register card instead) */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-40" style={{ background: '#0d0d12', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="mx-auto max-w-5xl flex items-center justify-between gap-4" style={{ padding: '14px 20px' }}>
          <div>
            {!allFree && <p style={{ fontSize: 11, color: '#8b8b94', margin: 0 }}>{multiPriced ? 'From' : 'Price'}</p>}
            <p style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.2 }}>
              {priceLabel}{!allFree && <span style={{ fontSize: 12, fontWeight: 500, color: '#8b8b94' }}> /ticket</span>}
            </p>
          </div>
          <a href={ev.soldOut ? undefined : '#register'} style={{ ...buyBtn, ...(ev.soldOut ? { background: '#3f3f46', pointerEvents: 'none', color: '#a1a1aa' } : {}) }}>
            {ev.soldOut ? 'Sold out' : allFree ? 'Register' : 'Get tickets'}
          </a>
        </div>
      </div>
    </div>
  );
}

const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const sheet: React.CSSProperties = { background: '#16161c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18 };
const titleStyle: React.CSSProperties = { fontSize: 'clamp(24px, 6.5vw, 34px)', fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.15, letterSpacing: '-0.4px', textShadow: '0 2px 20px rgba(0,0,0,0.55)' };
const sectionHeading: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: '#f4f4f5', margin: '0 0 12px', letterSpacing: '-0.2px' };
const buyBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '13px 28px', borderRadius: 12, background: '#6366f1', color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' };
