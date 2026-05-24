import { headers } from 'next/headers';
import { SiteHeader } from '../components/site-header';
import { PricingPlans } from './pricing-plans';

type CreditPack = {
  name: string;
  credits: number;
  amount: string;
};

const ngPacks: CreditPack[] = [
  { name: 'Mini', credits: 200, amount: 'N2,000' },
  { name: 'Starter', credits: 500, amount: 'N5,000' },
  { name: 'Growth', credits: 1_000, amount: 'N10,000' },
  { name: 'Pro', credits: 6_000, amount: 'N54,000' },
];

const usPacks: CreditPack[] = [
  { name: 'Starter', credits: 1_000, amount: '$12' },
  { name: 'Growth', credits: 10_000, amount: '$100' },
  { name: 'Scale', credits: 50_000, amount: '$450' },
];

type PricingRegion = {
  key: 'NGN' | 'USD';
  title: string;
  rows: CreditPack[];
};

function PricingFAQ() {
  const faqs = [
    {
      question: 'What is the difference between one-time and monthly plans?',
      answer:
        'One-time plans charge once and add credits immediately. Monthly plans renew automatically every month with the same credit volume.',
    },
    {
      question: 'Do unused credits roll over to the next month?',
      answer:
        'Unused credits expire at the end of the billing cycle. This helps keep plan usage predictable and pricing transparent.',
    },
    {
      question: 'Can I upgrade or downgrade my monthly commitment?',
      answer:
        'Yes. You can switch to a higher or lower plan as your support volume changes, and your next billing cycle will reflect the update.',
    },
    {
      question: 'How is my region-based pricing selected?',
      answer:
        'We detect your location from request headers and automatically show either NGN or USD packs to match your billing region.',
    },
    {
      question: 'Do I get any free credits?',
      answer:
        'Yes. Your first organization includes starter credits. Additional organizations require paid credit packs.',
    },
  ];

  return (
    <section className="mt-14">
      <div className="text-center">
        <h3 className="text-3xl font-semibold tracking-tight text-zinc-100">Frequently asked questions</h3>
        <p className="mt-3 text-zinc-400 max-w-2xl mx-auto">
          Everything you need to know about our plans, credits, and billing.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        {faqs.map((item) => (
          <article key={item.question} className="rounded-2xl border border-blue-300/20 bg-blue-300/10 p-5">
            <h4 className="text-base font-medium text-zinc-100">{item.question}</h4>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function detectPricingRegion(): PricingRegion {
  const requestHeaders = headers();
  const country =
    requestHeaders.get('x-vercel-ip-country') ||
    requestHeaders.get('cf-ipcountry') ||
    requestHeaders.get('x-country-code') ||
    '';

  if (country.toUpperCase() === 'NG') {
    return {
      key: 'NGN',
      title: 'Nigeria (NGN) credit packs',
      rows: ngPacks,
    };
  }

  return {
    key: 'USD',
    title: 'US / Global (USD) credit packs',
    rows: usPacks,
  };
}

export default function PricingPage() {
  const pricingRegion = detectPricingRegion();

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <SiteHeader active="pricing" showHomeLink />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_24%),radial-gradient(circle_at_20%_12%,rgba(191,219,254,0.10),transparent_26%),radial-gradient(circle_at_80%_18%,rgba(251,207,232,0.08),transparent_22%),radial-gradient(circle_at_50%_70%,rgba(255,255,255,0.04),transparent_18%)]" />

      <main className="relative z-10 min-h-screen overflow-hidden px-4 sm:px-6 md:px-10 pt-28 sm:pt-32 pb-10 md:pb-14 bg-[#020817]">

        <div className="relative z-10 mx-auto max-w-6xl">
          <section className="text-center">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-zinc-100">
              Find the perfect plan for your project
            </h1>
            <p className="mt-4 text-zinc-400 max-w-3xl mx-auto text-base sm:text-lg">
              Choose a flexible credit plan that matches your support volume and scale with confidence.
            </p>
          </section>

          <section className="mt-10">
            <p className="text-center text-sm text-zinc-500">{pricingRegion.title}</p>
            <div className="mt-6">
              <PricingPlans rows={pricingRegion.rows} />
            </div>
          </section>

          <PricingFAQ />
        </div>
      </main>
    </div>
  );
}
