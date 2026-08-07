import Link from 'next/link';
import { LandingNavAuth } from './LandingNavAuth';
import { ThemeToggle } from './ThemeToggle';

// showThemeToggle defaults to false — only pages actually converted to support both themes should
// pass true. Pages still hardcoded dark-only (event detail, ticket) would otherwise show a toggle
// that produces a broken half-light/half-dark page once clicked.
export function SiteHeader({ className = '', showThemeToggle = false, showSignIn = true }: { className?: string; showThemeToggle?: boolean; showSignIn?: boolean }) {
  return (
    <header className={`flex items-center justify-between max-w-[1280px] mx-auto w-full px-4 sm:px-6 md:px-10 py-5 sm:py-7 gap-3 ${className}`}>
      <Link href="/" className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192x192.png" alt="" className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg" />
        <span className="font-brand font-semibold text-sm sm:text-base tracking-wide text-zinc-900 dark:text-white whitespace-nowrap">TIXTRON</span>
      </Link>
      <div className="flex items-center gap-2.5 sm:gap-4 md:gap-7 shrink-0">
        <LandingNavAuth showSignIn={showSignIn} />
        {showThemeToggle && <ThemeToggle />}
      </div>
    </header>
  );
}
