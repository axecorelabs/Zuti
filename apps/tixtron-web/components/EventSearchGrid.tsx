import Link from 'next/link';
import { CalendarDays, MapPin, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { EventSearchPanel } from './EventSearchPanel';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const PAGE_SIZE = 24;

export interface PublicEvent {
  slug: string;
  name: string;
  eventDate: string | null;
  eventEndDate: string | null;
  eventDateHasTime: boolean;
  venue: string | null;
  city: string | null;
  category: string | null;
  locationType: string;
  bannerUrl: string | null;
  flierUrl: string | null;
  currency: string;
  isFree: boolean;
  fromPriceMinor: number;
  organizerName: string | null;
}
interface EventsResponse { items: PublicEvent[]; total: number; limit: number; offset: number }

export const EVENT_CATEGORIES = [
  { value: 'MUSIC', label: 'Music' },
  { value: 'NIGHTLIFE', label: 'Nightlife' },
  { value: 'ARTS_CULTURE', label: 'Arts & Culture' },
  { value: 'BUSINESS', label: 'Business & Professional' },
  { value: 'FOOD_DRINK', label: 'Food & Drink' },
  { value: 'SPORTS_FITNESS', label: 'Sports & Fitness' },
  { value: 'COMMUNITY', label: 'Community' },
  { value: 'EDUCATION', label: 'Education' },
  { value: 'COMEDY', label: 'Comedy' },
  { value: 'FESTIVAL', label: 'Festival' },
  { value: 'FAMILY_KIDS', label: 'Family & Kids' },
  { value: 'RELIGIOUS', label: 'Religious' },
  { value: 'OTHER', label: 'Other' },
];

function categoryLabel(value: string | null): string | null {
  if (!value) return null;
  return EVENT_CATEGORIES.find((c) => c.value === value)?.label ?? null;
}

async function getEvents(params: { search?: string; category?: string; city?: string; dateFrom?: string; dateTo?: string; offset: number }): Promise<EventsResponse> {
  try {
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(params.offset) });
    if (params.search) qs.set('search', params.search);
    if (params.category) qs.set('category', params.category);
    if (params.city) qs.set('city', params.city);
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    const res = await fetch(`${API_URL}/api/public/events?${qs.toString()}`, { next: { revalidate: 30 } });
    if (!res.ok) return { items: [], total: 0, limit: PAGE_SIZE, offset: params.offset };
    return res.json();
  } catch {
    return { items: [], total: 0, limit: PAGE_SIZE, offset: params.offset };
  }
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function priceLabel(ev: PublicEvent): string {
  if (ev.isFree) return 'Free';
  return `${ev.currency} ${(ev.fromPriceMinor / 100).toLocaleString()}`;
}

function EventThumb({ ev, className }: { ev: PublicEvent; className: string }) {
  const image = ev.bannerUrl ?? ev.flierUrl;
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className={`${className} object-cover`} />;
  }
  return <div className={`${className} bg-[linear-gradient(150deg,#E6E8EB,#C7CBD1)] dark:bg-[linear-gradient(150deg,#1D2023,#14161A)]`} />;
}

/** Buckets a page of (already date-ordered) results into scannable time groups instead of one
 * flat list — "This week" vs "next month" reads faster than a raw chronological feed once there's
 * more than a handful of events. Bucketing is by day-offset from today, not calendar-week-aligned,
 * so it stays simple and deterministic. Undated ("ongoing"/TBA) events get their own trailing group. */
function groupEventsByTime(items: PublicEvent[]): { label: string; items: PublicEvent[] }[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const oneDay = 24 * 60 * 60 * 1000;

  const buckets: { label: string; items: PublicEvent[] }[] = [
    { label: 'This week', items: [] },
    { label: 'Next week', items: [] },
    { label: 'Later', items: [] },
    { label: 'Date to be announced', items: [] },
  ];

  for (const ev of items) {
    if (!ev.eventDate) {
      buckets[3].items.push(ev);
      continue;
    }
    const d = new Date(ev.eventDate);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((d.getTime() - now.getTime()) / oneDay);
    if (diffDays <= 7) buckets[0].items.push(ev);
    else if (diffDays <= 14) buckets[1].items.push(ev);
    else buckets[2].items.push(ev);
  }

  return buckets.filter((b) => b.items.length > 0);
}

function EventCard({ ev }: { ev: PublicEvent }) {
  const label = categoryLabel(ev.category);
  const locationText = [ev.venue, ev.city].filter(Boolean).join(', ')
    || (ev.locationType !== 'PHYSICAL' ? 'Online' : 'Location TBA');

  return (
    <Link
      href={`/e/${ev.slug}`}
      className="group flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-md dark:hover:shadow-none transition-all"
    >
      <div className="relative aspect-[4/3] overflow-hidden shrink-0">
        <EventThumb ev={ev} className="w-full h-full transition-transform duration-300 group-hover:scale-[1.04]" />
        {label && (
          <span className="absolute top-2.5 left-2.5 bg-black/55 backdrop-blur-sm text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">
            {label}
          </span>
        )}
        <span className="absolute top-2.5 right-2.5 bg-white/90 dark:bg-zinc-950/80 backdrop-blur-sm text-zinc-900 dark:text-white text-xs font-semibold px-2.5 py-1 rounded-full tabular-nums">
          {priceLabel(ev)}
        </span>
      </div>

      <div className="flex flex-col flex-1 p-4">
        <p className="text-[14.5px] font-semibold text-zinc-900 dark:text-white truncate mb-1.5">{ev.name}</p>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1 min-w-0">
          <CalendarDays className="w-3 h-3 shrink-0" />
          <span className="truncate">{formatShortDate(ev.eventDate) || 'Date TBA'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 min-w-0">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{locationText}</span>
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-600 truncate">{ev.organizerName ?? 'Tixtron'}</span>
          <span className="flex items-center gap-1 text-xs font-semibold text-zinc-900 dark:text-white shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            Book now <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/** The search panel + category pills + results grid, as one unit — used both embedded on the
 * landing page and as the whole of the dedicated /search page, so "search better" always lands
 * somewhere with the full filtering UI rather than the hero's single field. */
export async function EventSearchGrid({ search, category, city, dateFrom, dateTo, page, heading }: {
  search?: string; category?: string; city?: string; dateFrom?: string; dateTo?: string; page?: string; heading?: string;
}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;
  const { items, total } = await getEvents({ search, category, city, dateFrom, dateTo, offset });
  const isFiltered = Boolean(search?.trim() || category?.trim() || city?.trim() || dateFrom?.trim());
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groups = groupEventsByTime(items);

  const pageHref = (targetPage: number) => {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (category) qs.set('category', category);
    if (city) qs.set('city', city);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    if (targetPage > 1) qs.set('page', String(targetPage));
    return `/search${qs.toString() ? `?${qs.toString()}` : ''}`;
  };

  return (
    <div>
      <div className="mb-6">
        <EventSearchPanel defaultSearch={search} defaultCity={city} defaultDateFrom={dateFrom} defaultDateTo={dateTo} defaultCategory={category} />
      </div>

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mb-6 -mx-1 px-1">
        {EVENT_CATEGORIES.map((c) => {
          const qs = new URLSearchParams();
          if (search) qs.set('search', search);
          if (city) qs.set('city', city);
          if (dateFrom) qs.set('dateFrom', dateFrom);
          if (dateTo) qs.set('dateTo', dateTo);
          if (category !== c.value) qs.set('category', c.value);
          return (
            <Link
              key={c.value}
              href={`/search${qs.toString() ? `?${qs.toString()}` : ''}`}
              className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                category === c.value
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between mb-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">
          {heading ?? (search ? `Results for "${search}"` : category ? categoryLabel(category) ?? 'Events' : 'Upcoming events')}
        </h2>
        {isFiltered && <Link href="/search" className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300">← Clear filters</Link>}
        {!isFiltered && total > 0 && <span className="text-xs text-zinc-500 dark:text-zinc-600">{total} event{total === 1 ? '' : 's'}</span>}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 py-16 text-center">
          <CalendarDays className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">{isFiltered ? 'No events match your search.' : 'No events yet — check back soon.'}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-600 mt-1">Are you an organizer? <Link href="/register" className="text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300">Create your first event →</Link></p>
        </div>
      ) : (
        <div className="space-y-9">
          {groups.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-600 mb-4">{group.label}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {group.items.map((ev) => (
                  <EventCard key={ev.slug} ev={ev} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-8">
          {pageNum > 1 ? (
            <Link href={pageHref(pageNum - 1)} className="flex items-center gap-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
              <ChevronLeft className="w-4 h-4" /> Previous
            </Link>
          ) : <span />}
          <span className="text-xs text-zinc-500 dark:text-zinc-600">Page {pageNum} of {totalPages}</span>
          {pageNum < totalPages ? (
            <Link href={pageHref(pageNum + 1)} className="flex items-center gap-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
              Next <ChevronRight className="w-4 h-4" />
            </Link>
          ) : <span />}
        </div>
      )}
    </div>
  );
}
