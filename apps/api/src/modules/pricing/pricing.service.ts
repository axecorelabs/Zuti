import { BadRequestException, Injectable } from '@nestjs/common';
import { AiUsageType } from '@prisma/client';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { computeUsageCredits } from '../billing/credit-model';

export type PricingMarket = 'NG' | 'US';

type CreditPack = {
  id: string;
  name: string;
  credits: number;
  amountMinor: number;
  currency: 'NGN' | 'USD';
};

type SubscriptionPlan = {
  id: string;
  name: string;
  amountMinor: number;
  currency: 'NGN' | 'USD';
  includedCredits: number;
  description: string;
};

type PricingCatalog = {
  market: PricingMarket;
  currency: 'NGN' | 'USD';
  minimumPackCredits: number;
  creditPacks: CreditPack[];
  subscriptions: SubscriptionPlan[];
};

function buildCommitmentsFromPacks(
  marketPrefix: 'ng' | 'us',
  packs: CreditPack[],
): SubscriptionPlan[] {
  return packs.map((pack) => ({
    id: `${marketPrefix}_${pack.name.toLowerCase()}_monthly_commitment`,
    name: `${pack.name} Monthly Commitment`,
    amountMinor: pack.amountMinor,
    currency: pack.currency,
    includedCredits: pack.credits,
    description: 'Auto-renews monthly with the same credit allocation as this one-time pack.',
  }));
}

const NG_PACKS: CreditPack[] = [
  { id: 'ng_mini_200', name: 'Mini', credits: 200, amountMinor: 200000, currency: 'NGN' },
  { id: 'ng_starter_500', name: 'Starter', credits: 500, amountMinor: 500000, currency: 'NGN' },
  { id: 'ng_growth_1000', name: 'Growth', credits: 1000, amountMinor: 1000000, currency: 'NGN' },
  { id: 'ng_pro_6000', name: 'Pro', credits: 6000, amountMinor: 5400000, currency: 'NGN' },
];

const US_PACKS: CreditPack[] = [
  { id: 'us_starter_1000', name: 'Starter', credits: 1000, amountMinor: 1200, currency: 'USD' },
  { id: 'us_growth_10000', name: 'Growth', credits: 10000, amountMinor: 10000, currency: 'USD' },
  { id: 'us_scale_50000', name: 'Scale', credits: 50000, amountMinor: 45000, currency: 'USD' },
];

const NG_CATALOG: PricingCatalog = {
  market: 'NG',
  currency: 'NGN',
  minimumPackCredits: 200,
  creditPacks: NG_PACKS,
  subscriptions: buildCommitmentsFromPacks('ng', NG_PACKS),
};

const US_CATALOG: PricingCatalog = {
  market: 'US',
  currency: 'USD',
  minimumPackCredits: 1000,
  creditPacks: US_PACKS,
  subscriptions: buildCommitmentsFromPacks('us', US_PACKS),
};

function toMoney(amountMinor: number, currency: 'NGN' | 'USD') {
  const amount = amountMinor / 100;
  return currency === 'NGN' ? Number(amount.toFixed(0)) : Number(amount.toFixed(2));
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

@Injectable()
export class PricingService {
  constructor(private readonly aiUsage: AiUsageService) {}

  private readonly billableUsageTypes: AiUsageType[] = ['CUSTOMER_REPLY', 'SUMMARIZATION'];

  getCatalog(market: PricingMarket) {
    return market === 'NG' ? NG_CATALOG : US_CATALOG;
  }

  async buildEstimates(organizationId: string, market: PricingMarket) {
    const catalog = this.getCatalog(market);
    const [summary30, summary7, daily30] = await Promise.all([
      this.aiUsage.summarize(organizationId, 30, this.billableUsageTypes),
      this.aiUsage.summarize(organizationId, 7, this.billableUsageTypes),
      this.aiUsage.summarizeDailyCredits(organizationId, 30, this.billableUsageTypes),
    ]);

    const periodDays = Math.max(1, summary30.period.days);

    // Use the same hybrid model as runtime debits: base per action + included tokens + overage.
    const creditsUsed30 = computeUsageCredits(
      summary30.totals.promptTokens,
      summary30.totals.completionTokens,
      summary30.totals.calls,
    );
    const creditsUsed7 = computeUsageCredits(
      summary7.totals.promptTokens,
      summary7.totals.completionTokens,
      summary7.totals.calls,
    );

    const creditsPerDay30 = creditsUsed30 / Math.max(1, summary30.period.days);
    const creditsPerDay7 = creditsUsed7 / Math.max(1, summary7.period.days);

    const activeDays = daily30.activeDays;
    const activeDayCredits = daily30.days.reduce(
      (sum, day) => sum + computeUsageCredits(day.promptTokens, day.completionTokens, day.calls),
      0,
    );
    const activeDayCreditsPerDay = activeDays > 0 ? activeDayCredits / activeDays : 0;

    const effectiveCreditsPerDay = Math.max(creditsPerDay30, creditsPerDay7, activeDayCreditsPerDay);

    const confidence =
      summary30.totals.calls >= 50 && activeDays >= 10
        ? 'HIGH'
        : summary30.totals.calls >= 12 && activeDays >= 4
          ? 'MEDIUM'
          : 'LOW';

    const burnRates = {
      creditsPerDay7: round2(creditsPerDay7),
      creditsPerDay30: round2(creditsPerDay30),
      activeDayCreditsPerDay: round2(activeDayCreditsPerDay),
      effectiveCreditsPerDay: round2(effectiveCreditsPerDay),
    };

    return {
      market: catalog.market,
      currency: catalog.currency,
      creditsPerDay: burnRates.effectiveCreditsPerDay,
      sourceWindowDays: periodDays,
      burnRates,
      confidence,
      activeDays,
      billableCallsLast30d: summary30.totals.calls,
      packEstimates: catalog.creditPacks.map((pack) => ({
        packId: pack.id,
        credits: pack.credits,
        estimatedDays:
          burnRates.effectiveCreditsPerDay > 0
            ? Number((pack.credits / burnRates.effectiveCreditsPerDay).toFixed(1))
            : null,
      })),
    };
  }

  async quotePackPurchase(organizationId: string, market: PricingMarket, packId: string) {
    const catalog = this.getCatalog(market);
    const pack = catalog.creditPacks.find((candidate) => candidate.id === packId);
    if (!pack) {
      throw new BadRequestException('Unknown credit pack for selected market');
    }

    const estimates = await this.buildEstimates(organizationId, market);
    const packEstimate = estimates.packEstimates.find((x) => x.packId === pack.id);

    return {
      market,
      currency: catalog.currency,
      pack: {
        id: pack.id,
        name: pack.name,
        credits: pack.credits,
        amount: toMoney(pack.amountMinor, pack.currency),
      },
      estimate: {
        creditsPerDay: estimates.creditsPerDay,
        estimatedDays: packEstimate?.estimatedDays ?? null,
      },
      note:
        'Quote is informational. Final checkout amount must be validated server-side before wallet crediting.',
    };
  }
}
