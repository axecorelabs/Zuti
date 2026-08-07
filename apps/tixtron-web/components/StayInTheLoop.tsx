import { Send, Mail, ArrowRight } from 'lucide-react';
import { LandingEmailSignup } from '@/components/LandingEmailSignup';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function getCommunityJoinLink(): Promise<{ deepLink: string; communityName: string } | null> {
  try {
    const res = await fetch(`${API_URL}/api/public/community/join-link`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.deepLink ? data : null;
  } catch {
    return null;
  }
}

/** The two channels that aren't tied to any one purchase: the platform community and Tixtron's
 * own email list. Both are explicit opt-ins, never implied. Shared between the landing page and
 * the /search page so the funnel isn't only reachable from "/". */
export async function StayInTheLoop() {
  const communityJoin = await getCommunityJoinLink();

  return (
    <div className="max-w-[1180px] mx-auto px-6 md:px-8 pt-16 pb-20">
      <div className="text-center mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400 mb-3">Stay in the loop</p>
        <h2 className="font-brand text-2xl md:text-[28px] font-bold tracking-tight text-zinc-900 dark:text-white">Never miss what&apos;s happening on Tixtron</h2>
        <p className="text-sm text-zinc-500 mt-2 max-w-md mx-auto">New events, presales, and highlights from organizers across the platform — however you&apos;d rather hear about them.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-6">
          <div className="w-10 h-10 rounded-xl bg-brand-600/[0.10] border border-brand-600/20 flex items-center justify-center mb-4">
            <Send className="w-4.5 h-4.5 text-brand-600 dark:text-brand-400" />
          </div>
          <h3 className="font-brand text-base font-semibold text-zinc-900 dark:text-white mb-1.5">Join the Tixtron community</h3>
          <p className="text-sm text-zinc-500 mb-5">Real-time drops and event highlights from organizers across the whole platform, on Telegram.</p>
          {communityJoin ? (
            <a
              href={communityJoin.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:bg-zinc-700 dark:hover:bg-zinc-200 text-sm font-semibold px-5 py-2.5 rounded-full transition-colors"
            >
              Join on Telegram <ArrowRight className="w-3.5 h-3.5" />
            </a>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-600">Coming soon</p>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-6">
          <div className="w-10 h-10 rounded-xl bg-brand-600/[0.10] border border-brand-600/20 flex items-center justify-center mb-4">
            <Mail className="w-4.5 h-4.5 text-brand-600 dark:text-brand-400" />
          </div>
          <h3 className="font-brand text-base font-semibold text-zinc-900 dark:text-white mb-1.5">Get updates by email</h3>
          <p className="text-sm text-zinc-500 mb-5">We&apos;ll only send you things worth opening — no spam, unsubscribe anytime.</p>
          <LandingEmailSignup />
        </div>
      </div>
    </div>
  );
}
