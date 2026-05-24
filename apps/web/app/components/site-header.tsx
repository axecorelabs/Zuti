"use client";

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

type SiteHeaderProps = {
  active: 'home' | 'pricing';
  user?: boolean;
  showHomeLink?: boolean;
};

export function SiteHeader({ active, user = false, showHomeLink = false }: SiteHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-30 px-4 sm:px-6 md:px-10 lg:px-16 pt-4 sm:pt-6 pb-3 sm:pb-4 backdrop-blur-lg bg-[#020817]/80 border-b border-zinc-900/80">
      <div className="mx-auto max-w-7xl flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 sm:w-10 h-8 sm:h-10 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] shrink-0">
            <Image src="/icon.png" alt="Zuti logo" width={40} height={40} className="w-full h-full object-cover" priority />
          </div>
          <div className="min-w-0">
            <span className="font-logo font-semibold text-sm sm:text-lg tracking-tight leading-none">Zuti</span>
            <p className="hidden sm:block text-[11px] text-zinc-500 tracking-[0.28em] uppercase mt-0.5">AI customer support</p>
          </div>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {showHomeLink && active !== 'home' ? (
            <Link
              href="/"
              className="inline-flex items-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors whitespace-nowrap"
            >
              Home
            </Link>
          ) : null}

          {active !== 'pricing' ? (
            <Link
              href="/pricing"
              className="inline-flex items-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors whitespace-nowrap"
            >
              Pricing
            </Link>
          ) : null}

          {user ? (
            <Link href="/dashboard" className="inline-flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-full bg-white text-black hover:bg-zinc-100 transition-colors whitespace-nowrap">
              Open dashboard
              <ArrowRight className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="inline-flex items-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors whitespace-nowrap">
                Sign in
              </Link>
              <Link href="/register" className="inline-flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-full bg-white text-black hover:bg-zinc-100 transition-colors whitespace-nowrap">
                Get started
                <ArrowRight className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
