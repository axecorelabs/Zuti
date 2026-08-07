import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-900 mt-4">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192x192.png" alt="" className="w-9 h-9 rounded-lg" />
          <div>
            <p className="font-brand font-semibold text-zinc-900 dark:text-white text-[15px] tracking-wide">TIXTRON</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-600 mt-0.5">Smart ticketing. Seamless experiences.</p>
          </div>
        </div>
        <nav className="flex items-center gap-7 text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Find events</Link>
          <Link href="/login" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Sign in</Link>
          <Link href="/register" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Create an event</Link>
        </nav>
      </div>
      <div className="border-t border-zinc-200 dark:border-zinc-900">
        <p className="max-w-[1280px] mx-auto px-6 md:px-10 py-5 text-xs text-zinc-400 dark:text-zinc-700">© 2026 axecorelabs</p>
      </div>
    </footer>
  );
}
