"use client";

import Link from 'next/link';
import { useState } from 'react';

type CreditPack = {
  name: string;
  credits: number;
  amount: string;
};

type BillingMode = 'one-time' | 'monthly';

function getPlanFeatures(row: CreditPack, billingMode: BillingMode): string[] {
  const credits = row.credits.toLocaleString();

  if (billingMode === 'monthly') {
    return [
      `${credits} monthly credits included`,
      'AI chat automations',
      'Reporting and conversion tracking',
      'Priority support for your team',
      'Flexible monthly commitment',
    ];
  }

  return [
    `${credits} credits included`,
    'AI chat automations',
    'Reporting and conversion tracking',
    'Priority support for your team',
    'One-time top-up with no renewal',
  ];
}

export function PricingPlans({ rows }: { rows: CreditPack[] }) {
  const [billingMode, setBillingMode] = useState<BillingMode>('one-time');

  const gridClass =
    rows.length === 3
      ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
      : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4';

  return (
    <section>
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border border-blue-300/25 bg-blue-300/10 p-1">
          <button
            type="button"
            onClick={() => setBillingMode('one-time')}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              billingMode === 'one-time'
                ? 'bg-white text-black'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            One-time
          </button>
          <button
            type="button"
            onClick={() => setBillingMode('monthly')}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              billingMode === 'monthly'
                ? 'bg-white text-black'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            Monthly commitment
          </button>
        </div>
      </div>

      <div className={`mt-6 ${gridClass}`}>
        {rows.map((row) => {
          const features = getPlanFeatures(row, billingMode);
          const paymentLabel = billingMode === 'monthly' ? '/mth' : '';

          return (
            <article
              key={row.name}
              className="group relative h-full rounded-3xl border border-blue-300/20 bg-blue-300/10 p-5 sm:p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-blue-300/35 hover:bg-blue-300/15"
            >
              <p className="text-4xl font-semibold tracking-tight text-zinc-100">
                {row.amount}
                {paymentLabel ? <span className="text-zinc-400 text-2xl">{paymentLabel}</span> : null}
              </p>
              <p className="mt-2 text-xl text-zinc-100">{row.name} plan</p>
              <p className="mt-1 text-sm text-zinc-500">
                {billingMode === 'monthly' ? 'Billed monthly.' : 'One-time payment.'}
              </p>

              <ul className="mt-5 space-y-2.5 text-sm text-zinc-300">
                {features.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-blue-300/30 text-[10px] text-blue-200">
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-6 space-y-2.5">
                <Link
                  href="/register"
                  className="block text-center rounded-xl border border-zinc-700 bg-white text-black text-sm font-medium px-4 py-2.5 transition-colors hover:bg-zinc-100"
                >
                  {billingMode === 'monthly' ? 'Start subscription' : 'Buy once'}
                </Link>
                <Link
                  href="/register"
                  className="block text-center rounded-xl border border-blue-300/25 text-blue-100/80 text-sm px-4 py-2.5 transition-colors hover:text-blue-50 hover:border-blue-300/40"
                >
                  Chat to sales
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
