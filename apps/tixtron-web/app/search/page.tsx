import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { EventSearchGrid } from '@/components/EventSearchGrid';
import { StayInTheLoop } from '@/components/StayInTheLoop';
import { Breadcrumb } from '@/components/Breadcrumb';

export const metadata: Metadata = {
  title: 'Search events · Tixtron',
  description: 'Search real events from real organizers on Tixtron.',
};

export default async function SearchPage({ searchParams }: {
  searchParams: Promise<{ search?: string; category?: string; city?: string; dateFrom?: string; dateTo?: string; page?: string }>;
}) {
  const { search, category, city, dateFrom, dateTo, page } = await searchParams;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 flex flex-col">
      <SiteHeader showThemeToggle />
      <div className="max-w-[1180px] mx-auto w-full px-6 md:px-8 pt-10 pb-16 flex-1">
        <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Search' }]} />
        <h1 className="font-brand text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-6">Find your next event</h1>
        <EventSearchGrid search={search} category={category} city={city} dateFrom={dateFrom} dateTo={dateTo} page={page} />
      </div>
      <StayInTheLoop />
      <SiteFooter />
    </div>
  );
}
