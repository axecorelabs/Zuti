import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { HeroDotGrid } from '@/components/HeroDotGrid';
import { SiteHeader } from '@/components/SiteHeader';
import { HeroSearchBox } from '@/components/HeroSearchBox';

// The landing page is deliberately a single, full-viewport screen — a fast search entry point,
// nothing to scroll past. The organizer/creator-dashboard pitch (benefits, community deep-dive,
// host CTA) lives at /organizers instead, reachable via the bottom-right overlay below.
export default function Home() {
  return (
    <div className="h-screen flex flex-col bg-white dark:bg-black relative overflow-hidden">
      <HeroDotGrid />
      <SiteHeader className="relative z-10" showThemeToggle showSignIn={false} />

      {/* Hero — full viewport height */}
      <div className="relative z-10 flex-1 flex items-center">
        <div className="max-w-[820px] mx-auto w-full px-6 md:px-10 flex flex-col items-center text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400 mb-5 opacity-0 animate-fade-up motion-reduce:opacity-100 motion-reduce:animate-none [animation-delay:0ms]">Event Ticketing · 2026</p>
          <h1 className="font-brand text-[46px] md:text-[68px] font-bold tracking-tight text-zinc-900 dark:text-white leading-[1.05] mb-7 opacity-0 animate-fade-up motion-reduce:opacity-100 motion-reduce:animate-none [animation-delay:90ms]">
            Find your next<span className="block font-normal text-zinc-400 dark:text-zinc-500">unforgettable experience.</span>
          </h1>
          <p className="text-lg text-zinc-500 leading-relaxed max-w-md mb-10 opacity-0 animate-fade-up motion-reduce:opacity-100 motion-reduce:animate-none [animation-delay:180ms]">
            Search real events from real organizers — concerts, parties, workshops, and everything between.
          </p>

          <HeroSearchBox className="opacity-0 animate-fade-up motion-reduce:opacity-100 motion-reduce:animate-none [animation-delay:270ms]" />
          <p className="text-sm text-zinc-500 dark:text-zinc-600 mt-5 opacity-0 animate-fade-up motion-reduce:opacity-100 motion-reduce:animate-none [animation-delay:350ms]">
            <span className="text-zinc-600 dark:text-zinc-400 font-medium">Verified organizers</span> · <span className="text-zinc-600 dark:text-zinc-400 font-medium">Secure payment</span> via Paystack
          </p>
        </div>
      </div>

      <Link
        href="/organizers"
        className="group fixed bottom-6 right-6 z-20 inline-flex items-center gap-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:bg-zinc-700 dark:hover:bg-zinc-200 text-sm font-semibold pl-5 pr-4 py-3 rounded-full shadow-lg transition-colors opacity-0 animate-fade-up motion-reduce:opacity-100 motion-reduce:animate-none [animation-delay:450ms]"
      >
        Start hosting
        <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </Link>
    </div>
  );
}
