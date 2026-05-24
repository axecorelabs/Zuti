"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

import {
  ArrowRight,
  Leaf,
} from 'lucide-react';
import { gsap } from 'gsap';
import { useAuthStore } from '@/lib/store';

type RevealElement = HTMLElement & { dataset: { reveal?: string } };

const heroWalkthrough = [
  {
    title: '1. Every customer message lands in one place',
    desc: 'Whether customers reach out by chat, email, or Telegram, every conversation is captured in one thread with full context.',
    badge: 'Step 1',
  },
  {
    title: '2. AI prepares a clear first response',
    desc: 'Zuti drafts replies using your approved help content, so answers are fast, accurate, and consistent with your brand voice.',
    badge: 'Step 2',
  },
  {
    title: '3. Complex cases are handed to the right person',
    desc: 'If a conversation needs a human, Zuti routes it with the full history so your team can pick up instantly without customers repeating themselves.',
    badge: 'Step 3',
  },
  {
    title: '4. Action forwarding keeps things moving',
    desc: 'When a request needs a next step (like billing, ops, or a specialist), Zuti forwards the action to the right team with full context and keeps the customer updated.',
    badge: 'Step 4',
  },
];

export default function Home() {
  const { user, loadFromStorage } = useAuthStore((s) => ({
    user: s.user,
    loadFromStorage: s.loadFromStorage,
  }));
  const heroStepTitleRef = useRef<HTMLHeadingElement | null>(null);
  const heroStepDescRef = useRef<HTMLParagraphElement | null>(null);
  const heroStepBadgeRef = useRef<HTMLSpanElement | null>(null);
  const [activeHeroStep, setActiveHeroStep] = useState(0);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('is-visible');
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -10% 0px' },
    );

    const targets = Array.from(document.querySelectorAll('[data-reveal]')) as RevealElement[];
    targets.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!heroStepTitleRef.current || !heroStepDescRef.current || !heroStepBadgeRef.current) return;

    gsap.killTweensOf([heroStepTitleRef.current, heroStepDescRef.current, heroStepBadgeRef.current]);
    gsap.fromTo(
      [heroStepBadgeRef.current, heroStepTitleRef.current, heroStepDescRef.current],
      { autoAlpha: 0, y: 12 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.42,
        ease: 'power2.out',
        stagger: 0.05,
        overwrite: true,
      },
    );
  }, [activeHeroStep]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setActiveHeroStep((prev) => (prev + 1) % heroWalkthrough.length);
    }, 5200);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://zuti.bords.app/widget.js';
    script.async = true;
    script.setAttribute('data-zuti-widget-key', 'zwk_331cc064ab21e508c9b5437a564b6f0f5505');
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
      delete (window as any).__zutiWidgetInitialized;
    };
  }, []);

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_24%),radial-gradient(circle_at_20%_12%,rgba(191,219,254,0.10),transparent_26%),radial-gradient(circle_at_80%_18%,rgba(251,207,232,0.08),transparent_22%),radial-gradient(circle_at_50%_70%,rgba(255,255,255,0.04),transparent_18%)]" />

      <header className="fixed inset-x-0 top-0 z-30 px-4 sm:px-6 md:px-10 lg:px-16 pt-4 sm:pt-6 pb-3 sm:pb-4 backdrop-blur-lg bg-black/70">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-8 sm:w-10 h-8 sm:h-10 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] shrink-0">
              <Image src="/icon.png" alt="Zuti logo" width={40} height={40} className="w-full h-full object-cover" priority />
            </div>
            <div className="min-w-0">
              <span className="font-logo font-semibold text-sm sm:text-lg tracking-tight leading-none">Zuti</span>
              <p className="hidden sm:block text-[11px] text-zinc-500 tracking-[0.28em] uppercase mt-0.5">AI customer support</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link href="/pricing" className="inline-flex items-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors whitespace-nowrap">
              Pricing
            </Link>
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

      <main className="relative z-10 bg-[#020817]">
        <section className="px-4 sm:px-6 md:px-10 lg:px-16 min-h-screen flex items-center justify-center relative overflow-hidden">
          <Leaf aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1300px] h-[1300px] md:w-[1750px] md:h-[1750px] text-blue-300/10 dark:text-blue-300/10" />
          <div className="mx-auto max-w-5xl w-full text-center flex flex-col items-center justify-center relative z-10">
            <div data-reveal className="reveal-block max-w-4xl mx-auto">
              <h1 className="font-brand font-semibold text-3xl sm:text-4xl md:text-5xl lg:text-7xl leading-[0.92] tracking-tight max-w-4xl mx-auto">
                 Your support workspace, powered by AI.
              </h1>

              <p className="mt-4 sm:mt-6 text-zinc-400 text-sm sm:text-base md:text-lg leading-relaxed max-w-2xl mx-auto px-2">
                Zuti helps your team answer questions instantly, keeps every reply accurate, and knows when to bring in a human.
              </p>

              <div className="mt-6 sm:mt-8 mx-auto max-w-2xl rounded-2xl sm:rounded-3xl border border-zinc-800/90 bg-zinc-950/65 backdrop-blur px-4 sm:px-5 py-3 sm:py-4 text-left text-xs sm:text-sm">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">System process</p>
                  <div className="flex items-center gap-2" aria-label="Walkthrough progress">
                    {heroWalkthrough.map((step, index) => (
                      <button
                        key={step.badge}
                        type="button"
                        aria-label={`Go to ${step.badge}`}
                        aria-current={index === activeHeroStep ? 'step' : undefined}
                        onClick={() => setActiveHeroStep(index)}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          index === activeHeroStep ? 'w-7 bg-blue-300' : 'w-3 bg-zinc-700 hover:bg-zinc-500'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-4 min-h-[84px]">
                  <span ref={heroStepBadgeRef} className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-300">
                    {heroWalkthrough[activeHeroStep].badge}
                  </span>
                  <h3 ref={heroStepTitleRef} className="mt-3 text-lg sm:text-xl font-medium text-zinc-100 leading-tight">
                    {heroWalkthrough[activeHeroStep].title}
                  </h3>
                  <p ref={heroStepDescRef} className="mt-2 text-sm sm:text-base text-zinc-400 leading-relaxed">
                    {heroWalkthrough[activeHeroStep].desc}
                  </p>
                </div>
              </div>

              <div className="mt-6 sm:mt-8 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                <Link href="/register" className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-black text-sm font-medium hover:bg-zinc-100 transition-colors">
                  Start free workspace
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link href="/login" className="inline-flex items-center px-5 py-3 rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 text-sm transition-colors whitespace-nowrap">
                  Existing account
                </Link>
              </div>

              <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.24em] sm:tracking-[0.32em] text-zinc-500">
                <span>Support teams</span>
                <span>•</span>
                <span>Ops leads</span>
                <span>•</span>
                <span>Customer success</span>
                <span>•</span>
                <span>Founders</span>
              </div>
            </div>


          </div>
        </section>
      </main>
      <footer className="w-full border-t border-zinc-800 bg-[#020817]/90 py-6 sm:py-8 px-4 sm:px-6 md:px-10 lg:px-16 text-zinc-400 text-xs sm:text-sm flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <Image src="/icon.png" alt="Zuti logo" width={28} height={28} className="rounded-xl border border-zinc-800 bg-zinc-900" />
          <span className="font-brand font-semibold text-base sm:text-lg text-white">Zuti</span>
          <span className="mx-2 text-zinc-600">|</span>
          <span>AI-native customer support</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs">
          <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
          <a href="mailto:axecore.org@gmail.com" className="hover:text-white transition-colors">Contact</a>
          <span className="text-zinc-600">© {new Date().getFullYear()} AxecoreLabs</span>
        </div>
      </footer>
    </div>
    );
  }
