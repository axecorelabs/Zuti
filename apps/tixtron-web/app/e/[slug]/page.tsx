import type { Metadata } from 'next';
import { CalendarDays, MapPin, Building2, Video } from 'lucide-react';
import RegisterForm from './register-form';
import EventDescription from './description';
import ShareButton from './share-button';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumb } from '@/components/Breadcrumb';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  MUSIC: 'Music', NIGHTLIFE: 'Nightlife', ARTS_CULTURE: 'Arts & Culture', BUSINESS: 'Business & Professional',
  FOOD_DRINK: 'Food & Drink', SPORTS_FITNESS: 'Sports & Fitness', COMMUNITY: 'Community', EDUCATION: 'Education',
  COMEDY: 'Comedy', FESTIVAL: 'Festival', FAMILY_KIDS: 'Family & Kids', RELIGIOUS: 'Religious', OTHER: 'Other',
};

interface Tier {
  id: string; name: string; description: string | null; priceMinor: number;
  currency: string; isFree: boolean; spotsLeft: number | null; soldOut: boolean;
}
interface EventData {
  slug: string; name: string; description: string | null; eventDate: string | null;
  eventEndDate: string | null; eventDateHasTime: boolean;
  venue: string | null; city: string | null; category: string | null; locationType?: string; bannerUrl: string | null; flierUrl: string | null;
  currency: string; isFree: boolean; priceMinor: number; requiresApproval: boolean;
  fields: Array<{ key: string; label: string; type: string; required: boolean; options?: string[] }>;
  hasTiers: boolean; ticketTypes: Tier[]; capacity: number | null; spotsLeft: number | null; soldOut: boolean;
  organizerName: string | null;
}

function formatPublicEventDate(ev: EventData): string | null {
  if (!ev.eventDate) return null;
  const start = new Date(ev.eventDate);
  const end = ev.eventEndDate ? new Date(ev.eventEndDate) : null;
  const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const startDateStr = start.toLocaleDateString('en-GB', dateOpts);
  if (!end) return ev.eventDateHasTime ? `${startDateStr}, ${start.toLocaleTimeString('en-GB', timeOpts)}` : startDateStr;

  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return ev.eventDateHasTime
      ? `${startDateStr}, ${start.toLocaleTimeString('en-GB', timeOpts)} – ${end.toLocaleTimeString('en-GB', timeOpts)}`
      : startDateStr;
  }
  const endDateStr = ev.eventDateHasTime
    ? `${end.toLocaleDateString('en-GB', dateOpts)}, ${end.toLocaleTimeString('en-GB', timeOpts)}`
    : end.toLocaleDateString('en-GB', dateOpts);
  return `${startDateStr}${ev.eventDateHasTime ? `, ${start.toLocaleTimeString('en-GB', timeOpts)}` : ''} – ${endDateStr}`;
}

async function getEvent(slug: string): Promise<EventData | null> {
  try {
    const res = await fetch(`${API_URL}/api/public/events/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } });
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
    title: `${ev.name} · Tixtron`,
    description: ev.description ?? `Get tickets for ${ev.name}`,
    openGraph: {
      title: ev.name,
      description: ev.description ?? `Get tickets for ${ev.name}`,
      images: ev.bannerUrl ? [{ url: ev.bannerUrl }] : ev.flierUrl ? [{ url: ev.flierUrl }] : [],
    },
  };
}

function InfoRow({ icon: Icon, title, subtitle }: { icon: typeof CalendarDays; title: string; subtitle?: string | null }) {
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-brand-600/[0.10] border border-brand-600/20 shrink-0">
        <Icon className="w-[19px] h-[19px] text-brand-600 dark:text-brand-400" />
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">{title}</p>
        {subtitle && <p className="text-[13px] text-zinc-500 mt-0.5 leading-snug">{subtitle}</p>}
      </div>
    </div>
  );
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await getEvent(slug);

  if (!ev) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex flex-col">
        <SiteHeader showThemeToggle />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="rounded-[18px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none text-center max-w-[380px] p-8">
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Event not found</p>
            <p className="text-[13px] text-zinc-500 mt-2">This link may be invalid or the event is no longer public.</p>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const eventDate = formatPublicEventDate(ev);

  // Cheapest ticket → the "from" price on the sticky bar.
  const tierPrices = ev.hasTiers ? ev.ticketTypes.map((t) => t.priceMinor) : [ev.priceMinor];
  const minMinor = Math.min(...tierPrices);
  const allFree = ev.hasTiers ? ev.ticketTypes.every((t) => t.isFree) : ev.isFree;
  const multiPriced = ev.hasTiers && ev.ticketTypes.length > 1 && !allFree;
  const priceLabel = allFree ? 'Free' : `${ev.currency} ${(minMinor / 100).toLocaleString()}`;
  const heroImg = ev.bannerUrl ?? ev.flierUrl;
  const isOnline = ev.locationType === 'ONLINE' || ev.locationType === 'HYBRID';

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <SiteHeader showThemeToggle />
      <div className="mx-auto w-full max-w-[1080px] pb-28 lg:pb-14">
        {/* Hero */}
        <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden mx-4 sm:mx-6 lg:mx-8 mt-2">
          {heroImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroImg} alt={ev.name} className="block w-full object-cover" style={{ height: 'min(48vh, 480px)' }} />
          ) : (
            <div
              className="w-full"
              style={{ height: 220, backgroundImage: 'linear-gradient(135deg, #3A1F0F 0%, #1D2023 45%, #14161A 100%)' }}
            />
          )}
          {/* Always a fixed dark scrim, regardless of site theme — the overlaid title/breadcrumb
              text below is fixed light-on-photo, not theme-conditional. */}
          <div aria-hidden className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(to top, rgba(15,17,21,1) 0%, rgba(15,17,21,0.32) 45%, rgba(15,17,21,0.12) 100%)' }} />
          <div className="absolute top-4 left-4 sm:top-5 sm:left-5 bg-black/45 backdrop-blur-sm border border-white/15 rounded-full px-3.5 py-2">
            <Breadcrumb variant="overlay" items={[{ label: 'Home', href: '/' }, { label: ev.name }]} />
          </div>
          <div className="absolute top-4 right-4 sm:top-5 sm:right-5">
            <ShareButton title={ev.name} />
          </div>
          <div className="absolute inset-x-0 bottom-0 px-5 pb-5 lg:pb-9">
            {ev.category && EVENT_CATEGORY_LABELS[ev.category] && (
              <span className="inline-block mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand-400 bg-black/55 backdrop-blur-sm border border-brand-600/40 rounded-full px-2.5 py-1">
                {EVENT_CATEGORY_LABELS[ev.category]}
              </span>
            )}
            <h1 className="font-brand text-[clamp(26px,5.2vw,44px)] font-bold text-white leading-[1.1] tracking-tight" style={{ textShadow: '0 2px 20px rgba(0,0,0,0.55)' }}>{ev.name}</h1>
            {(ev.venue || ev.city) && <p className="mt-2.5 text-[15px] text-white/75" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.5)' }}>{[ev.venue, ev.city].filter(Boolean).join(', ')}</p>}
            {isOnline && !ev.venue && !ev.city && <p className="mt-2.5 text-[15px] text-white/75" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.5)' }}>Online event</p>}
          </div>
        </div>

        {/* Body — two columns on desktop (details | sticky register), one column on mobile */}
        <div className="px-4 sm:px-6 lg:px-8 pt-6 lg:pt-10 lg:grid lg:grid-cols-[1fr_380px] lg:gap-12 lg:items-start">
          {/* Left: details */}
          <div className="min-w-0 space-y-8">
            <div className="rounded-[18px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none px-5 divide-y divide-zinc-100 dark:divide-zinc-800">
              {eventDate && <InfoRow icon={CalendarDays} title={eventDate} />}
              {(ev.venue || ev.city) && <InfoRow icon={MapPin} title={[ev.venue, ev.city].filter(Boolean).join(', ')} subtitle="Location" />}
              {isOnline && <InfoRow icon={Video} title="Online event" subtitle="Join link sent with your ticket" />}
              {ev.organizerName && <InfoRow icon={Building2} title={ev.organizerName} subtitle="Organizer" />}
            </div>

            {ev.description && (
              <div>
                <h2 className="font-brand text-[17px] lg:text-lg font-bold text-zinc-900 dark:text-white mb-3 tracking-tight">About this event</h2>
                <EventDescription text={ev.description} />
              </div>
            )}
          </div>

          {/* Right: register card (sticky on desktop; sits below the details on mobile) */}
          <div id="register" className="mt-8 lg:mt-0 lg:sticky lg:top-6 scroll-mt-6 rounded-[18px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-md dark:shadow-none">
            <div className="p-5 lg:p-6">
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  {!allFree && <p className="text-[11px] text-zinc-500">{multiPriced ? 'From' : 'Price'}</p>}
                  <p className="text-xl font-extrabold text-zinc-900 dark:text-white leading-tight tabular-nums">
                    {priceLabel}{!allFree && <span className="text-xs font-medium text-zinc-500"> /ticket</span>}
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

      </div>

      <div className="pb-24 lg:pb-0">
        <SiteFooter />
      </div>

      {/* Mobile-only sticky bottom bar (desktop shows the register card instead) */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-[1080px] flex items-center justify-between gap-4 px-5 py-3.5">
          <div>
            {!allFree && <p className="text-[11px] text-zinc-500">{multiPriced ? 'From' : 'Price'}</p>}
            <p className="text-lg font-extrabold text-zinc-900 dark:text-white leading-tight tabular-nums">
              {priceLabel}{!allFree && <span className="text-xs font-medium text-zinc-500"> /ticket</span>}
            </p>
          </div>
          <a
            href={ev.soldOut ? undefined : '#register'}
            className={`inline-flex items-center justify-center px-7 py-[13px] rounded-xl text-white text-[15px] font-bold whitespace-nowrap ${ev.soldOut ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 pointer-events-none' : 'bg-brand-600 hover:bg-brand-500'}`}
          >
            {ev.soldOut ? 'Sold out' : allFree ? 'Register' : 'Get tickets'}
          </a>
        </div>
      </div>
    </div>
  );
}
