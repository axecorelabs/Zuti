'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Gauge, RefreshCw, Repeat, Wallet, XCircle } from 'lucide-react';
import { aiUsageApi, billingApi, orgsApi, pricingApi } from '@/lib/api';

type PaymentModalState = {
  open: boolean;
  phase: 'verifying' | 'success' | 'failed';
  title: string;
  message: string;
};

interface Org {
  id: string;
  name: string;
}

interface AiUsageSummary {
  period: { start: string; end: string; days: number };
  totals: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number };
  byUsageType: Array<{
    usageType: string;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
}

interface PricingCatalog {
  market: 'NG' | 'US';
  currency: 'NGN' | 'USD';
  minimumPackCredits: number;
  creditPacks: Array<{
    id: string;
    name: string;
    credits: number;
    amountMinor: number;
    currency: 'NGN' | 'USD';
  }>;
  subscriptions: Array<{
    id: string;
    name: string;
    amountMinor: number;
    currency: 'NGN' | 'USD';
    includedCredits: number;
    description: string;
  }>;
}

interface PricingEstimates {
  creditsPerDay: number;
  sourceWindowDays: number;
  burnRates?: {
    creditsPerDay7: number;
    creditsPerDay30: number;
    activeDayCreditsPerDay: number;
    effectiveCreditsPerDay: number;
  };
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
  activeDays?: number;
  billableCallsLast30d?: number;
  packEstimates: Array<{ packId: string; credits: number; estimatedDays: number | null }>;
}

interface WalletLedgerEntry {
  id: string;
  type: string;
  creditsDelta: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
  transactionId: string | null;
}

interface WalletSnapshot {
  organizationId: string;
  plan: string;
  creditBalance: number;
  committedMonthlyCredits: number;
  commitmentRenewsAt: string | null;
  recentLedger: WalletLedgerEntry[];
}

const DAYS_OPTIONS = [7, 30, 90] as const;
type Days = typeof DAYS_OPTIONS[number];

function inferMarketFromClient(): 'NG' | 'US' {
  if (typeof window === 'undefined') return 'US';

  const locale = Intl.DateTimeFormat().resolvedOptions().locale?.toUpperCase() ?? '';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.toUpperCase() ?? '';

  if (locale.endsWith('-NG') || locale.includes('_NG')) return 'NG';
  if (timeZone.includes('LAGOS') || timeZone.startsWith('AFRICA/')) return 'NG';

  return 'US';
}

function money(amountMinor: number, currency: 'NGN' | 'USD'): string {
  const amount = amountMinor / 100;
  if (currency === 'NGN') return `₦${Math.round(amount).toLocaleString()}`;
  return `$${amount.toFixed(2)}`;
}

const RUNWAY_CAP_DAYS = 365;

function formatRunwayDays(days: number | null): string {
  if (days === null) return '—';
  if (days > RUNWAY_CAP_DAYS) return `${RUNWAY_CAP_DAYS}+d`;
  return `${days.toLocaleString()}d`;
}

function formatPackEstimateRange(
  packCredits: number,
  burnRates?: PricingEstimates['burnRates'],
): string {
  if (!burnRates) return 'Usage estimate calibrating';

  const rates = [
    burnRates.creditsPerDay7,
    burnRates.creditsPerDay30,
    burnRates.activeDayCreditsPerDay,
  ].filter((v) => Number.isFinite(v) && v > 0);

  if (rates.length === 0) return 'Usage estimate calibrating';

  const fastest = Math.max(...rates);
  const slowest = Math.min(...rates);
  const lowDays = Math.max(1, Math.round(packCredits / fastest));
  const highDays = Math.max(1, Math.round(packCredits / slowest));

  if (highDays > RUNWAY_CAP_DAYS) {
    if (lowDays > RUNWAY_CAP_DAYS) return `${RUNWAY_CAP_DAYS}+ days`;
    return `${lowDays}-${RUNWAY_CAP_DAYS}+ days`;
  }

  return lowDays === highDays ? `${lowDays} days` : `${lowDays}-${highDays} days`;
}

export default function BillingUsagePage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [days, setDays] = useState<Days>(30);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [market] = useState<'NG' | 'US'>(() => inferMarketFromClient());
  const [pricing, setPricing] = useState<PricingCatalog | null>(null);
  const [estimates, setEstimates] = useState<PricingEstimates | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<'ONE_TIME' | 'AUTO_RENEW'>('ONE_TIME');
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [billingNotice, setBillingNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'BUY_CREDITS'>('OVERVIEW');
  const [paymentModal, setPaymentModal] = useState<PaymentModalState>({
    open: false,
    phase: 'verifying',
    title: '',
    message: '',
  });

  const loadWallet = async (orgId: string) => {
    try {
      const res = await billingApi.wallet(orgId);
      setWallet(res.data as WalletSnapshot);
    } catch {
      setWallet(null);
    }
  };

  const loadUsage = async (targetOrg: Org, targetDays: Days) => {
    setLoading(true);
    try {
      const res = await aiUsageApi.summary(targetOrg.id, targetDays);
      setUsage(res.data);
    } catch {
      setUsage(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    orgsApi.list()
      .then((res) => {
        const orgs = (res.data ?? []) as Array<{ id: string; name: string }>;
        const callbackOrgId = typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('org')
          : null;
        const selected = (callbackOrgId
          ? orgs.find((item) => item.id === callbackOrgId)
          : null) ?? orgs[0];

        if (!selected) {
          setLoading(false);
          return;
        }
        const nextOrg = { id: selected.id, name: selected.name };
        setOrg(nextOrg);
        loadUsage(nextOrg, 30);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!org) return;
    loadUsage(org, days);
  }, [days]);

  useEffect(() => {
    if (!org) return;
    setPricingLoading(true);
    Promise.all([
      pricingApi.catalog(org.id, market),
      pricingApi.estimates(org.id, market),
    ])
      .then(([catalogRes, estimatesRes]) => {
        setPricing(catalogRes.data as PricingCatalog);
        setEstimates(estimatesRes.data as PricingEstimates);
      })
      .catch(() => {
        setPricing(null);
        setEstimates(null);
      })
      .finally(() => setPricingLoading(false));
  }, [org?.id, market]);

  useEffect(() => {
    if (!org) return;
    loadWallet(org.id);
  }, [org?.id]);

  useEffect(() => {
    if (!org) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference');
    if (!reference) return;

    setPaymentModal({
      open: true,
      phase: 'verifying',
      title: 'Verifying Payment',
      message: 'Please wait while we confirm your transaction and update your wallet.',
    });
    setBillingNotice('Verifying payment...');
    billingApi.verifyCheckout(org.id, reference)
      .then(async (res) => {
        const ok = Boolean(res?.data?.ok);
        if (ok) {
          await loadWallet(org.id);
          setBillingNotice('Payment verified and credits updated.');
          setPaymentModal({
            open: true,
            phase: 'success',
            title: 'Payment Successful',
            message: 'Your payment was verified and your credits have been updated.',
          });
          return;
        }

        setBillingNotice('Payment verification failed. Please retry from Billing.');
        setPaymentModal({
          open: true,
          phase: 'failed',
          title: 'Payment Failed',
          message: 'We could not verify this payment. If you were charged, contact support with your payment reference.',
        });
      })
      .catch(() => {
        setBillingNotice('Payment verification failed. Please retry from Billing.');
        setPaymentModal({
          open: true,
          phase: 'failed',
          title: 'Payment Verification Error',
          message: 'We could not verify this payment right now. Please retry from Billing in a moment.',
        });
      })
      .finally(() => {
        params.delete('reference');
        params.delete('org');
        const next = params.toString();
        window.history.replaceState({}, '', next ? `?${next}` : window.location.pathname);
      });
  }, [org?.id]);

  const checkoutPack = async (packId: string) => {
    if (!org) return;
    setCheckoutLoading(packId);
    setBillingNotice(null);
    try {
      const callbackUrl = `${window.location.origin}/billing-usage?org=${org.id}`;
      const res = await billingApi.checkoutPack(org.id, market, packId, callbackUrl);
      const url = String(res.data?.authorizationUrl ?? '');
      if (!url) throw new Error('No authorization URL returned');
      window.location.href = url;
    } catch {
      setBillingNotice('Unable to start checkout. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const checkoutCommitment = async (subscriptionId: string) => {
    if (!org) return;
    setCheckoutLoading(subscriptionId);
    setBillingNotice(null);
    try {
      const callbackUrl = `${window.location.origin}/billing-usage?org=${org.id}`;
      const res = await billingApi.checkoutCommitment(org.id, market, subscriptionId, callbackUrl);
      const url = String(res.data?.authorizationUrl ?? '');
      if (!url) throw new Error('No authorization URL returned');
      window.location.href = url;
    } catch {
      setBillingNotice('Unable to start commitment checkout. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const commitmentByPackId = useMemo(() => {
    const map = new Map<string, string>();
    if (!pricing) return map;

    for (const pack of pricing.creditPacks) {
      const matched = pricing.subscriptions.find((plan) => (
        plan.includedCredits === pack.credits
        && plan.amountMinor === pack.amountMinor
        && plan.currency === pack.currency
      ));
      if (matched) {
        map.set(pack.id, matched.id);
      }
    }
    return map;
  }, [pricing]);

  const checkoutForPack = async (packId: string) => {
    if (purchaseMode === 'ONE_TIME') {
      await checkoutPack(packId);
      return;
    }

    const commitmentId = commitmentByPackId.get(packId);
    if (!commitmentId) {
      setBillingNotice('Auto-renew option is unavailable for this pack right now.');
      return;
    }

    await checkoutCommitment(commitmentId);
  };

  const burnRatePerDay = estimates?.burnRates?.effectiveCreditsPerDay ?? estimates?.creditsPerDay ?? null;
  const estimateConfidence = estimates?.confidence ?? 'LOW';
  const isLowConfidence = estimateConfidence === 'LOW';

  const runwayDays = useMemo(() => {
    if (!wallet || !burnRatePerDay || burnRatePerDay <= 0) return null;
    return Number((wallet.creditBalance / burnRatePerDay).toFixed(1));
  }, [wallet, burnRatePerDay]);

  const runwayDisplay = useMemo(() => {
    if (isLowConfidence && runwayDays !== null) return 'Calibrating';
    return formatRunwayDays(runwayDays);
  }, [wallet, estimates]);

  const autoRenewEnabled = (wallet?.committedMonthlyCredits ?? 0) > 0;

  const nextRenewal = useMemo(() => {
    if (!wallet?.commitmentRenewsAt) return 'Not scheduled';
    const date = new Date(wallet.commitmentRenewsAt);
    if (Number.isNaN(date.getTime())) return 'Not scheduled';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, [wallet?.commitmentRenewsAt]);

  const lowBalanceRisk = useMemo(() => {
    if (!wallet) return { label: 'Unknown', tone: 'text-zinc-400' };
    if (wallet.creditBalance <= 0) return { label: 'Critical', tone: 'text-rose-300' };
    if (runwayDays === null) return { label: 'No usage trend', tone: 'text-zinc-400' };
    if (runwayDays < 7) return { label: 'High (< 7 days)', tone: 'text-rose-300' };
    if (runwayDays < 14) return { label: 'Medium (< 14 days)', tone: 'text-amber-300' };
    return { label: 'Healthy', tone: 'text-emerald-300' };
  }, [wallet, runwayDays]);

  return (
    <div className="billing-usage-page p-5 md:p-10">
      {paymentModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 w-9 h-9 rounded-lg border flex items-center justify-center ${
                  paymentModal.phase === 'success'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : paymentModal.phase === 'failed'
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                }`}
              >
                {paymentModal.phase === 'success' ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : paymentModal.phase === 'failed' ? (
                  <XCircle className="w-5 h-5" />
                ) : (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-white">{paymentModal.title}</h2>
                <p className="text-sm text-zinc-400 mt-1">{paymentModal.message}</p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              {paymentModal.phase === 'verifying' ? null : (
                <button
                  type="button"
                  onClick={() => setPaymentModal((prev) => ({ ...prev, open: false }))}
                  className="px-3.5 py-2 rounded-lg text-xs border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 md:p-7">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Billing</p>
              <h1 className="font-brand font-semibold text-2xl md:text-3xl tracking-tight text-white mt-2">Credits Control Center</h1>
              <p className="mt-2 text-sm text-zinc-400 max-w-2xl">
                Monitor credit health, predict runway, and top up quickly with one-time or monthly auto-renew purchases.
              </p>
              <div className="billing-tabs mt-4 inline-flex items-center gap-1 bg-zinc-900/70 border border-zinc-800 rounded-xl p-1">
                <button
                  onClick={() => setActiveTab('OVERVIEW')}
                  className={`billing-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    activeTab === 'OVERVIEW' ? 'is-active bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('BUY_CREDITS')}
                  className={`billing-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    activeTab === 'BUY_CREDITS' ? 'is-active bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Buy credits
                </button>
              </div>
            </div>
            <div className={`items-center gap-2 ${activeTab === 'OVERVIEW' ? 'flex' : 'hidden'}`}>
              <div className="billing-days-tabs flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                {DAYS_OPTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`billing-days-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      days === d ? 'is-active bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <button
                onClick={() => org && loadUsage(org, days)}
                disabled={loading || !org}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {billingNotice ? (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3.5">
            <p className="text-xs text-blue-300">{billingNotice}</p>
          </div>
        ) : null}

        {activeTab === 'OVERVIEW' ? (
          <>
            <section className="billing-stat-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="billing-stat-card card p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="billing-stat-label text-xs text-zinc-500 font-normal">Remaining credits</p>
              <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-blue-500/15 border-blue-500/20 text-blue-300">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <p className="billing-stat-value font-brand font-semibold text-3xl text-white tracking-tight">
              {wallet ? wallet.creditBalance.toLocaleString() : '—'}
            </p>
            <p className="billing-stat-subtext text-xs text-zinc-600 mt-1">current available balance</p>
          </div>

          <div className="billing-stat-card card p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="billing-stat-label text-xs text-zinc-500 font-normal">Burn rate</p>
              <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-rose-500/15 border-rose-500/20 text-rose-300">
                <Gauge className="w-4 h-4" />
              </div>
            </div>
            <p className="billing-stat-value font-brand font-semibold text-3xl text-white tracking-tight">
              {burnRatePerDay === null ? '—' : `${burnRatePerDay.toLocaleString()} /day`}
            </p>
            <p className="billing-stat-subtext text-xs text-zinc-600 mt-1">based on last {estimates?.sourceWindowDays ?? 30} days</p>
          </div>

          <div className="billing-stat-card card p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="billing-stat-label text-xs text-zinc-500 font-normal">Runway</p>
              <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-violet-500/15 border-violet-500/20 text-violet-300">
                <Gauge className="w-4 h-4" />
              </div>
            </div>
            <p className="billing-stat-value font-brand font-semibold text-3xl text-white tracking-tight">{runwayDisplay}</p>
            <p className="billing-stat-subtext text-xs text-zinc-600 mt-1">
              {isLowConfidence ? 'collecting enough activity to project stable runway' : 'at your current usage pace'}
            </p>
          </div>
              </section>

              <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-5 md:col-span-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-zinc-500">Account health</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-900/60 text-[11px] text-zinc-300">
                    <Calendar className="w-3.5 h-3.5 text-cyan-300" /> Next renewal: {nextRenewal}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-900/60 text-[11px] text-zinc-300">
                    <Repeat className="w-3.5 h-3.5 text-indigo-300" /> Auto-renew: {autoRenewEnabled ? 'On' : 'Off'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] ${lowBalanceRisk.label === 'Healthy' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                    <AlertTriangle className="w-3.5 h-3.5" /> Risk: {lowBalanceRisk.label}
                  </span>
                </div>
              </div>
            </div>
            </section>

            <section className="card p-7">
          <h2 className="text-base font-medium text-white">Recent Credit Activity</h2>
          <p className="text-xs text-zinc-600 mt-1 mb-4">Latest wallet movements across top-ups, renewals, and usage.</p>

          {!wallet?.recentLedger?.length ? (
            <p className="text-sm text-zinc-500">No credit activity yet.</p>
          ) : (
            <div className="space-y-2">
              {wallet.recentLedger.slice(0, 5).map((entry) => (
                <div key={entry.id} className="rounded-lg border border-zinc-900 bg-zinc-950/40 px-3 py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-zinc-200">{entry.description}</p>
                    <p className="text-[11px] text-zinc-600">{new Date(entry.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${entry.creditsDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {entry.creditsDelta >= 0 ? '+' : ''}{entry.creditsDelta.toLocaleString()} credits
                    </p>
                    <p className="text-[11px] text-zinc-600">Balance: {entry.balanceAfter.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
            </section>
          </>
        ) : (
          <>
          <section className="card p-7">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
              <div>
                <h2 className="text-base font-medium text-white">Buy Credits</h2>
                <p className="text-xs text-zinc-600 mt-1">
                  Same packs, two purchase modes: one-time top-up or monthly auto-renew.
                </p>
              </div>
              <div className="billing-purchase-tabs flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                <button
                  onClick={() => setPurchaseMode('ONE_TIME')}
                  className={`billing-purchase-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    purchaseMode === 'ONE_TIME' ? 'is-active bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  One-time
                </button>
                <button
                  onClick={() => setPurchaseMode('AUTO_RENEW')}
                  className={`billing-purchase-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    purchaseMode === 'AUTO_RENEW' ? 'is-active bg-blue-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Auto-renew monthly
                </button>
              </div>
            </div>

            {pricingLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl bg-zinc-900 animate-pulse" />)}
              </div>
            ) : !pricing ? (
              <p className="text-sm text-zinc-500">Unable to load pricing catalog.</p>
            ) : (
              <>
                <div className="mb-5 rounded-xl border border-zinc-900 bg-zinc-950/40 p-4 text-xs text-zinc-500">
                  Minimum purchasable pack: <span className="text-zinc-300">{pricing.minimumPackCredits} credits</span>
                  {market === 'NG' ? (
                    <span className="block mt-1 text-zinc-600">Flexible Nigerian entry starts at ₦2,000 for 200 credits.</span>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {pricing.creditPacks.map((pack) => {
                    const estimate = estimates?.packEstimates.find((e) => e.packId === pack.id);
                    const activeCheckoutId = purchaseMode === 'ONE_TIME'
                      ? pack.id
                      : (commitmentByPackId.get(pack.id) ?? `missing:${pack.id}`);

                    return (
                      <div key={pack.id} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-zinc-200">{pack.name}</p>
                            <p className="text-2xl font-semibold text-white mt-1">{money(pack.amountMinor, pack.currency)}</p>
                          </div>
                          <span className="text-[11px] px-2 py-1 rounded-full border border-zinc-700 text-zinc-400">
                            {pack.credits.toLocaleString()} credits
                          </span>
                        </div>

                        <p className="text-xs text-zinc-500 mt-3">Estimated duration: Based on usage.</p>

                        <p className="text-xs text-zinc-600 mt-1">
                          {purchaseMode === 'ONE_TIME'
                            ? 'Charged once and credited immediately.'
                            : 'Renews monthly with same amount and credits.'}
                        </p>

                        <button
                          onClick={() => checkoutForPack(pack.id)}
                          disabled={checkoutLoading !== null}
                          className="mt-4 w-full px-3 py-2 rounded-lg text-xs border border-blue-500/30 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
                        >
                          {checkoutLoading === activeCheckoutId
                            ? 'Starting...'
                            : (purchaseMode === 'ONE_TIME' ? 'Buy one-time credits' : 'Start auto-renew')}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <p className="text-[11px] text-zinc-600 mt-5">
                  Usage estimate uses your last {estimates?.sourceWindowDays ?? 30} days with confidence-aware burn rules.
                  Current pace: {burnRatePerDay?.toLocaleString() ?? 0} credits/day.
                  {isLowConfidence
                    ? ` Projection confidence is low until more activity is observed (calls: ${estimates?.billableCallsLast30d ?? 0}, active days: ${estimates?.activeDays ?? 0}).`
                    : ` Projection confidence: ${estimateConfidence.toLowerCase()}.`}
                </p>
              </>
            )}
          </section>

          <section className="card p-7">
            <details>
              <summary className="cursor-pointer text-sm font-normal text-white">Advanced usage breakdown (tokens)</summary>
              <p className="text-xs text-zinc-600 mt-1 mb-4">
                Detailed AI telemetry for operations teams. Hidden by default for a cleaner billing view.
              </p>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded bg-zinc-900 animate-pulse" />)}
                </div>
              ) : !usage || usage.byUsageType.length === 0 ? (
                <div className="text-sm text-zinc-500">No usage data yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-900">
                        <th className="py-2 pr-4 font-normal">Usage type</th>
                        <th className="py-2 pr-4 font-normal">Calls</th>
                        <th className="py-2 pr-4 font-normal">Prompt tokens</th>
                        <th className="py-2 pr-4 font-normal">Completion tokens</th>
                        <th className="py-2 font-normal">Total tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.byUsageType.map((row) => (
                        <tr key={row.usageType} className="border-b border-zinc-900/70">
                          <td className="py-2 pr-4 text-zinc-200">{row.usageType}</td>
                          <td className="py-2 pr-4 text-zinc-400">{row.calls.toLocaleString()}</td>
                          <td className="py-2 pr-4 text-zinc-400">{row.promptTokens.toLocaleString()}</td>
                          <td className="py-2 pr-4 text-zinc-400">{row.completionTokens.toLocaleString()}</td>
                          <td className="py-2 text-zinc-300">{row.totalTokens.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          </section>
          </>
        )}
      </div>
    </div>
  );
}
