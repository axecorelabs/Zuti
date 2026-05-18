"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, MessageSquareText, ShieldCheck, Sparkles, Leaf } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

type RevealElement = HTMLElement & { dataset: { reveal?: string } };

const pillars = [
  {
    title: 'AI-first inbox',
    desc: 'Answers routine customer questions instantly while keeping every reply on-brand and policy-aware.',
    icon: Sparkles,
  },
  {
    title: 'Human takeover',
    desc: 'Escalate to the right teammate with the full thread, customer context, and clear ownership.',
    icon: MessageSquareText,
  },
  {
    title: 'Knowledge-grounded',
    desc: 'Grounded replies come from approved URLs and writeups, not guesses or hidden rules.',
    icon: ShieldCheck,
  },
];

const heroWalkthrough = [
  {
    title: 'A customer sends a message',
    desc: 'You see the full conversation in one place, so you know what happened before.',
    badge: 'Message',
  },
  {
    title: 'AI replies to the customer right away',
    desc: 'It answers using your approved help content, so replies stay accurate and consistent.',
    badge: 'AI Reply',
  },
  {
    title: 'Need a person? Pass it to a teammate',
    desc: 'The next person gets the full chat, so customers never have to repeat themselves.',
    badge: 'Handoff',
  },
];

export default function Home() {
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const heroStepTitleRef = useRef<HTMLHeadingElement | null>(null);
  const heroStepDescRef = useRef<HTMLParagraphElement | null>(null);
  const heroStepBadgeRef = useRef<HTMLSpanElement | null>(null);
  const [activeHeroStep, setActiveHeroStep] = useState(0);

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
    gsap.registerPlugin(ScrollTrigger);

    const section = heroSectionRef.current;

    if (!section) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      return undefined;
    }

    const context = gsap.context(() => {
      let currentStep = -1;

      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: '+=220%',
        scrub: true,
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          const nextStep = Math.min(
            heroWalkthrough.length - 1,
            Math.floor(self.progress * heroWalkthrough.length),
          );

          if (nextStep !== currentStep) {
            currentStep = nextStep;
            setActiveHeroStep(nextStep);
          }
        },
      });
    }, section);

    return () => context.revert();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_24%),radial-gradient(circle_at_20%_12%,rgba(191,219,254,0.10),transparent_26%),radial-gradient(circle_at_80%_18%,rgba(251,207,232,0.08),transparent_22%),radial-gradient(circle_at_50%_70%,rgba(255,255,255,0.04),transparent_18%)]" />

      <header className="fixed inset-x-0 top-0 z-30 px-6 md:px-10 lg:px-16 pt-6 pb-4 backdrop-blur-lg bg-black/70">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <Image src="/icon.png" alt="Zuti logo" width={40} height={40} className="w-full h-full object-cover" priority />
            </div>
            <div>
              <span className="font-logo font-semibold text-lg tracking-tight leading-none">Zuti</span>
              <p className="text-[11px] text-zinc-500 tracking-[0.28em] uppercase mt-1">AI customer support</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex items-center px-3.5 py-2 text-sm rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors">
              Sign in
            </Link>
            <Link href="/register" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-full bg-white text-black hover:bg-zinc-100 transition-colors">
              Get started
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 pb-20 md:pb-28">
        <section ref={heroSectionRef} className="px-6 md:px-10 lg:px-16 min-h-screen flex items-center justify-center relative overflow-hidden">
          <Leaf aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1300px] h-[1300px] md:w-[1750px] md:h-[1750px] text-blue-300/10 dark:text-blue-300/10" />
          <div className="mx-auto max-w-5xl w-full text-center flex flex-col items-center justify-center relative z-10">
            <div data-reveal className="reveal-block max-w-4xl mx-auto">
              <h1 className="font-brand font-semibold text-4xl sm:text-5xl lg:text-7xl leading-[0.92] tracking-tight max-w-4xl mx-auto">
                 Your support workspace, powered by AI.
              </h1>

              <p className="mt-6 text-zinc-400 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
                Zuti helps your team answer questions instantly, keeps every reply accurate, and knows when to bring in a human.
              </p>

              <div className="mt-8 mx-auto max-w-2xl rounded-3xl border border-zinc-800/90 bg-zinc-950/65 backdrop-blur px-5 py-4 text-left">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Walkthrough</p>
                  <div className="flex items-center gap-2" aria-label="Walkthrough progress">
                    {heroWalkthrough.map((step, index) => (
                      <span
                        key={step.badge}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          index === activeHeroStep ? 'w-7 bg-blue-300' : 'w-3 bg-zinc-700'
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

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/register" className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-black text-sm font-medium hover:bg-zinc-100 transition-colors">
                  Start free workspace
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link href="/login" className="inline-flex items-center px-5 py-3 rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 text-sm transition-colors">
                  Existing account
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-[11px] uppercase tracking-[0.32em] text-zinc-500">
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



        <section className="px-6 md:px-10 lg:px-16 mt-20 md:mt-24">
          <div className="mx-auto max-w-5xl rounded-[2rem] border border-zinc-800 bg-zinc-950 overflow-hidden">
            <div className="grid md:grid-cols-[0.95fr_1.05fr]">
              <div data-reveal className="reveal-block p-6 md:p-8 lg:p-10">
                <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Why Zuti</p>
                <h2 className="mt-4 font-brand font-semibold text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-tight max-w-xl">
                  One clear surface for every support thread.
                </h2>
                <p className="mt-5 text-zinc-400 leading-relaxed max-w-xl">
                  Zuti keeps support structured without making the interface feel heavy. The composition stays sparse so the product can breathe.
                </p>

                <div className="mt-8 space-y-4 max-w-xl">
                  {pillars.map((item, index) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-white/5 border border-zinc-800 flex items-center justify-center shrink-0">
                        <item.icon className={`w-4 h-4 ${index === 0 ? 'text-blue-200' : index === 1 ? 'text-pink-200' : 'text-zinc-300'}`} />
                      </div>
                      <div>
                        <h3 className="text-base font-medium text-white">{item.title}</h3>
                        <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div data-reveal className="reveal-block reveal-delay-1 p-6 md:p-8 lg:p-10 border-t md:border-t-0 md:border-l border-zinc-800 relative overflow-hidden">
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_15%,rgba(191,219,254,0.12),transparent_26%),radial-gradient(circle_at_70%_70%,rgba(251,207,232,0.08),transparent_22%)]" />
                <div className="relative z-10">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Lightweight proof</p>
                  <div className="mt-5 rounded-[1.75rem] border border-zinc-800 bg-zinc-900/80 p-5 md:p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-2xl overflow-hidden border border-zinc-800 bg-blue-600/90 flex items-center justify-center">
                          <Image src="/icon.png" alt="Zuti logo" width={32} height={32} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <p className="text-sm text-zinc-100">Live support thread</p>
                          <p className="text-xs text-zinc-500">AI response + human handoff</p>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-400/20">Active</span>
                    </div>

                    <div className="mt-6 rounded-[1.5rem] border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
                      <div className="max-w-[85%] rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Customer</p>
                        <p className="mt-1 text-sm text-zinc-200">Hi, where is my refund status?</p>
                      </div>

                      <div className="ml-auto max-w-[85%] rounded-2xl border border-blue-400/25 bg-blue-500/10 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-blue-200">AI reply sent</p>
                        <p className="mt-1 text-sm text-zinc-100">Your refund is being processed and should arrive in 3 to 5 business days.</p>
                      </div>

                      <div className="rounded-2xl border border-orange-400/25 bg-orange-500/10 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-orange-200">Handoff</p>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-900/70 text-zinc-300">Assigned to Billing</span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-200">Full chat was passed to a human agent with context.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="w-full border-t border-zinc-800 bg-black/80 py-8 px-6 md:px-10 lg:px-16 text-zinc-400 text-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Image src="/icon.png" alt="Zuti logo" width={28} height={28} className="rounded-xl border border-zinc-800 bg-zinc-900" />
          <span className="font-brand font-semibold text-lg text-white">Zuti</span>
          <span className="mx-2 text-zinc-600">|</span>
          <span>AI-native customer support</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <a href="mailto:axecore.org@gmail.com" className="hover:text-white transition-colors">Contact</a>
          <span className="text-zinc-600">© {new Date().getFullYear()} AxecoreLabs</span>
        </div>
      </footer>
    </div>
    );
  }
