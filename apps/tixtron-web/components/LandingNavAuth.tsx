'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';

// The landing page itself is a server component (for SSR/ISR), but auth state only exists in
// localStorage — unreadable at render time on the server. This small client island checks it on
// mount and swaps the signed-out links for a direct link back into the dashboard when signed in.
//
// showSignIn is false only on the pure ticket-buyer landing page: a "Sign in" link there reads as
// "you must sign in to buy a ticket" to a first-time visitor, which isn't true — sign-in is for
// organizers. It's swapped for an "Events" link to the browse/search page instead, which is what a
// ticket-buying visitor actually wants from that slot. Pages aimed at organizers (e.g. /organizers)
// keep the real "Sign in" link, since it's unambiguous there.
export function LandingNavAuth({ showSignIn = true }: { showSignIn?: boolean }) {
  const { user, isLoading, loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  if (isLoading) {
    return <div className="w-[140px] sm:w-[190px]" aria-hidden="true" />; // reserve space, avoid a signed-out flash
  }

  if (user) {
    return (
      <Link href="/dashboard" className="text-xs sm:text-sm font-semibold whitespace-nowrap bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 px-4 py-2 sm:px-5 sm:py-2.5 rounded-full transition-colors">
        Go to dashboard
      </Link>
    );
  }

  return (
    <>
      {showSignIn ? (
        <Link href="/login" className="text-xs sm:text-sm whitespace-nowrap text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors">Sign in</Link>
      ) : (
        <Link href="/search" className="text-xs sm:text-sm whitespace-nowrap text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors">Events</Link>
      )}
      <Link href="/register" className="text-xs sm:text-sm font-semibold whitespace-nowrap bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 px-4 py-2 sm:px-5 sm:py-2.5 rounded-full transition-colors">Create an event</Link>
    </>
  );
}
