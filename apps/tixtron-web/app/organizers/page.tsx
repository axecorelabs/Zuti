import type { Metadata } from 'next';
import Link from 'next/link';
import { Ticket, Users2, Compass, CheckCircle2, ArrowRight } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumb } from '@/components/Breadcrumb';

export const metadata: Metadata = {
  title: 'Sell tickets & build your community · Tixtron',
  description: 'Create an event, sell tickets, and turn every buyer into a lasting community — all from one place.',
};

// The organizer/creator-dashboard pitch — moved off the landing page (which is now a single-screen
// search entry point) so it has room to actually make the case instead of competing for space.
export default function OrganizersPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 flex flex-col">
      <SiteHeader showThemeToggle />

      {/* Hero */}
      <div className="max-w-[820px] mx-auto w-full px-6 md:px-10 pt-16 pb-4 text-center">
        <div className="flex justify-center">
          <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'For organizers' }]} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400 mb-5">For organizers</p>
        <h1 className="font-brand text-[38px] md:text-[52px] font-bold tracking-tight text-zinc-900 dark:text-white leading-[1.1] mb-6">
          Sell tickets. Build a community that outlasts the event.
        </h1>
        <p className="text-lg text-zinc-500 leading-relaxed max-w-lg mx-auto mb-9">
          Create an event, set your price tiers, and get paid — then keep every ticket buyer close
          for the next one, on Telegram.
        </p>
        <Link href="/register" className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-7 py-3.5 rounded-full transition-colors">
          Get started free <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Benefits — ticketing is the door in, community is what makes it stick */}
      <div className="max-w-[1180px] mx-auto px-6 md:px-8 pt-20 pb-4 w-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {[
            { icon: Ticket, title: 'Sell tickets in minutes', body: 'Create an event, set your price tiers, and start selling — secure checkout via Paystack, tickets delivered instantly by email and Telegram.' },
            { icon: Users2, title: 'Build a real community', body: "Every ticket you sell can grow into a lasting Telegram community — not just a one-night crowd. Keep your audience close long after the event ends." },
            { icon: Compass, title: 'Get discovered', body: "Your event is searchable across Tixtron's own audience of real, ticket-buying event-goers — not just the people who already follow you." },
          ].map((f) => (
            <div key={f.title}>
              <div className="w-11 h-11 rounded-xl bg-brand-600/[0.10] border border-brand-600/20 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <h3 className="font-brand text-[17px] font-semibold text-zinc-900 dark:text-white tracking-tight mb-2">{f.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Community deep-dive — the part of Tixtron that isn't just ticketing */}
      <div className="max-w-[1180px] mx-auto px-6 md:px-8 pt-20 pb-4 w-full">
        <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-8 md:p-12 grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400 mb-4">Beyond the ticket</p>
            <h2 className="font-brand text-[28px] md:text-[34px] font-bold tracking-tight text-zinc-900 dark:text-white leading-[1.15] mb-4">
              Your event ends. Your community doesn&apos;t have to.
            </h2>
            <p className="text-[15px] text-zinc-500 leading-relaxed mb-6">
              Ticket buyers can join your own Telegram community with one tap from their ticket —
              no separate marketing list to build, no cold outreach. It&apos;s the same people who
              already showed up, now somewhere you can keep reaching them for the next one.
            </p>
            <ul className="space-y-3">
              {[
                'A dedicated Telegram channel for your own events — you control it',
                'Ticket holders opt in with one tap, right from their ticket',
                'Everyone can also discover other events across all of Tixtron',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <CheckCircle2 className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                  {line}
                </li>
              ))}
            </ul>
            <Link href="/register" className="inline-flex items-center gap-1.5 mt-7 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-6 py-3 rounded-full transition-colors">
              Start selling tickets <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-sm">
            <div className="flex items-center gap-3 pb-4 border-b border-zinc-100 dark:border-zinc-900">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0" style={{ backgroundImage: 'linear-gradient(135deg, #FF6A00, #B34B00)' }}>T</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">Tides &amp; Tribes Community</p>
                <p className="text-xs text-zinc-500">1,204 members</p>
              </div>
            </div>
            <div className="space-y-3 pt-4">
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 shrink-0" />
                <div className="bg-zinc-100 dark:bg-zinc-900 rounded-2xl rounded-tl-sm px-3.5 py-2 text-[13px] text-zinc-700 dark:text-zinc-300 max-w-[80%]">So hyped for this weekend! 🎉</div>
              </div>
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 shrink-0" />
                <div className="bg-zinc-100 dark:bg-zinc-900 rounded-2xl rounded-tl-sm px-3.5 py-2 text-[13px] text-zinc-700 dark:text-zinc-300 max-w-[80%]">Anyone know the dress code?</div>
              </div>
              <div className="flex gap-2.5 justify-end">
                <div className="bg-brand-600 rounded-2xl rounded-tr-sm px-3.5 py-2 text-[13px] text-white max-w-[80%]">See you all Friday — beachwear, bring your energy 🌊</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Host CTA */}
      <div className="max-w-[1180px] mx-auto px-6 md:px-8 pt-8 pb-20 w-full">
        <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 p-10 md:p-12 text-center bg-zinc-50 dark:bg-transparent dark:[background-image:linear-gradient(115deg,transparent_40%,rgba(255,255,255,0.03)_52%,transparent_64%),linear-gradient(135deg,#1a1d22_0%,#14161a_55%,#0F1115_100%)]">
          <h3 className="font-brand text-2xl font-semibold text-zinc-900 dark:text-white tracking-tight mb-2.5">Host your own event</h3>
          <p className="text-sm text-zinc-500 mb-6">Create an event, sell tickets, and get paid — all from one place.</p>
          <Link href="/register" className="inline-flex bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-6 py-3 rounded-full transition-colors">
            Get started free
          </Link>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
