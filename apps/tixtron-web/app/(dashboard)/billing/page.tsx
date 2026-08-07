'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Zap, Loader2, ArrowUpRight, History, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { billingApi, pricingApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

interface WalletLedgerEntry {
  id: string; type: string; creditsDelta: number; balanceAfter: number; description: string; createdAt: string;
}
interface WalletSnapshot {
  plan: string; creditBalance: number;
}

const LEDGER_PAGE_SIZE = 20;
interface CreditPack {
  id: string; name: string; credits: number; amountMinor: number; currency: 'NGN' | 'USD';
}
interface PricingCatalog { market: 'NG' | 'US'; currency: 'NGN' | 'USD'; creditPacks: CreditPack[] }

function inferMarket(): 'NG' | 'US' {
  if (typeof window === 'undefined') return 'US';
  const locale = Intl.DateTimeFormat().resolvedOptions().locale?.toUpperCase() ?? '';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.toUpperCase() ?? '';
  if (locale.endsWith('-NG') || locale.includes('_NG') || timeZone.startsWith('AFRICA/')) return 'NG';
  return 'US';
}

function money(amountMinor: number, currency: 'NGN' | 'USD'): string {
  const amount = amountMinor / 100;
  return currency === 'NGN' ? `₦${Math.round(amount).toLocaleString()}` : `$${amount.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const MESSAGES_PER_CREDIT = 10;

function CreditPackGrid({ catalog, checkoutLoading, buyPack, bestPackId, baselineRate, packsByCredits }: {
  catalog: PricingCatalog | null;
  checkoutLoading: string | null;
  buyPack: (packId: string) => void;
  bestPackId: string | null;
  baselineRate: number;
  packsByCredits: CreditPack[];
}) {
  const { theme } = useTheme();
  if (!catalog || catalog.creditPacks.length === 0) {
    return <p className="text-xs text-zinc-400 dark:text-zinc-600">Could not load pricing right now.</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {catalog.creditPacks.map((pack) => {
        const rate = pack.amountMinor / pack.credits;
        const savingsPct = baselineRate > 0 ? Math.round((1 - rate / baselineRate) * 100) : 0;
        const isBest = pack.id === bestPackId;
        // Tier rank (0 = smallest pack, 1 = largest) drives a progressively bolder sheen —
        // ascending visual weight as you move up tiers, one accent hue throughout (no rainbow).
        const rank = packsByCredits.length > 1 ? packsByCredits.findIndex((p) => p.id === pack.id) / (packsByCredits.length - 1) : 0;
        // Light mode: same orange sheen concept, fading into a white/off-white base instead of
        // dark charcoal — a permanently-dark card would fight the rest of a light page.
        const tint = theme === 'light' ? 0.05 + rank * 0.16 : 0.02 + rank * 0.11;
        const baseColor = theme === 'light' ? '250,250,251' : '22,24,27';
        return (
          <button
            key={pack.id}
            onClick={() => buyPack(pack.id)}
            disabled={checkoutLoading !== null}
            className={`relative overflow-hidden rounded-2xl border p-5 text-left transition-all disabled:opacity-40 ${
              isBest
                ? 'border-brand-600/50 shadow-lg shadow-brand-200 dark:shadow-brand-950/30 scale-[1.02]'
                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600'
            }`}
            style={{
              backgroundImage: `linear-gradient(135deg, rgba(255,106,0,${tint}) 0%, rgba(${baseColor},1) 55%)`,
            }}
          >
            {isBest && (
              <span className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-wide bg-brand-600 text-white px-1.5 py-0.5 rounded-full">Best value</span>
            )}
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.1em] mb-2"
              style={{ color: `rgba(255,106,0,${0.45 + rank * 0.55})` }}
            >
              {pack.name}
            </p>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold text-zinc-900 dark:text-white tabular-nums">{pack.credits.toLocaleString()}<span className="text-xs font-normal text-zinc-500 ml-1.5">credits</span></p>
                <p className="text-[11.5px] text-zinc-500 mt-1">≈ {(pack.credits * MESSAGES_PER_CREDIT).toLocaleString()} messages</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-semibold text-zinc-900 dark:text-white tabular-nums flex items-center gap-1 justify-end">
                  {checkoutLoading === pack.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : money(pack.amountMinor, pack.currency)}
                </p>
                {savingsPct > 0 && (
                  <p className="text-[10.5px] text-emerald-400 font-medium mt-0.5">Save {savingsPct}%</p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function BillingPageContent() {
  const { activeOrgId } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [market] = useState<'NG' | 'US'>(() => inferMarket());

  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [catalog, setCatalog] = useState<PricingCatalog | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const [ledgerItems, setLedgerItems] = useState<WalletLedgerEntry[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerLoadingMore, setLedgerLoadingMore] = useState(false);

  const loadWallet = async (orgId: string) => {
    try { const res = await billingApi.wallet(orgId); setWallet(res.data); } catch { setWallet(null); }
  };

  const fetchLedger = async (orgId: string, offset: number, replace: boolean) => {
    if (!replace) setLedgerLoadingMore(true);
    try {
      const res = await billingApi.ledger(orgId, LEDGER_PAGE_SIZE, offset);
      const items = res.data.items ?? [];
      setLedgerItems((prev) => (replace ? items : [...prev, ...items]));
      setLedgerTotal(res.data.total ?? 0);
    } catch { /* ignore */ }
    finally { if (!replace) setLedgerLoadingMore(false); }
  };

  useEffect(() => {
    if (!activeOrgId) return;
    setLoading(true);
    Promise.all([
      billingApi.wallet(activeOrgId).then((res) => setWallet(res.data)).catch(() => setWallet(null)),
      pricingApi.catalog(activeOrgId, market).then((res) => setCatalog(res.data)).catch(() => setCatalog(null)),
      orgsApi.list().then((res) => {
        const org = (res.data as Array<{ id: string; name: string }>).find((o) => o.id === activeOrgId);
        setOrgName(org?.name ?? null);
      }).catch(() => setOrgName(null)),
      fetchLedger(activeOrgId, 0, true),
    ]).finally(() => setLoading(false));
  }, [activeOrgId, market]);

  const loadMoreLedger = () => { if (activeOrgId) fetchLedger(activeOrgId, ledgerItems.length, false); };

  // Returning from Paystack checkout.
  useEffect(() => {
    const reference = searchParams.get('reference');
    if (!reference || !activeOrgId) return;
    setVerifying(true);
    billingApi.verifyCheckout(activeOrgId, reference)
      .then(async (res) => {
        if (res.data?.ok) {
          toast.success('Payment verified — credits added');
          await Promise.all([loadWallet(activeOrgId), fetchLedger(activeOrgId, 0, true)]);
        } else {
          toast.error('Payment verification failed');
        }
        router.replace('/billing');
      })
      .catch(() => { toast.error('Payment verification failed'); router.replace('/billing'); })
      .finally(() => setVerifying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, activeOrgId]);

  // Credit-pack math (1 credit = 10 messages) lives in the shared MESSAGES_PER_CREDIT constant above —
  // COMMS_CREDIT_UNITS_PER_RECIPIENT=10 units per send, CREDIT_UNITS_PER_CREDIT=100, apps/api/src/modules/billing/credit-model.ts.
  const packsByRate = catalog?.creditPacks.length
    ? [...catalog.creditPacks].sort((a, b) => (a.amountMinor / a.credits) - (b.amountMinor / b.credits))
    : [];
  const bestPackId = packsByRate[0]?.id ?? null;
  const baselineRate = packsByRate.length ? packsByRate[packsByRate.length - 1].amountMinor / packsByRate[packsByRate.length - 1].credits : 0;
  const packsByCredits = catalog?.creditPacks.length ? [...catalog.creditPacks].sort((a, b) => a.credits - b.credits) : [];

  const buyPack = async (packId: string) => {
    if (!activeOrgId) return;
    setCheckoutLoading(packId);
    try {
      const callbackUrl = `${window.location.origin}/billing?org=${activeOrgId}`;
      const res = await billingApi.checkoutPack(activeOrgId, market, packId, callbackUrl);
      const url = String(res.data?.authorizationUrl ?? '');
      if (!url) throw new Error('No checkout URL');
      window.location.href = url;
    } catch {
      toast.error('Could not start checkout — try again.');
      setCheckoutLoading(null);
    }
  };

  if (loading || verifying) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        {verifying && (
          <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Verifying your payment…
          </div>
        )}
        <div className="h-28 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
        <div className="h-40 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Billing</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Credits power Telegram broadcasts and event-update emails beyond your free monthly allotment.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Main column — wallet + purchase */}
        <div className="space-y-5 min-w-0">
          {/* Wallet card — the diagonal sheen, T-mark watermark, and orange accent bar are the same
              visual language as the brand lockup assets, applied to something functionally real. */}
          <div
            className="relative overflow-hidden rounded-[22px] border border-zinc-200 dark:border-zinc-800"
            style={{
              backgroundImage:
                'linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.035) 52%, transparent 64%), linear-gradient(135deg, #1a1d22 0%, #14161a 55%, #0F1115 100%)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192x192.png" alt="" className="absolute -right-10 -bottom-10 w-48 h-48 opacity-[0.09] -rotate-[8deg] pointer-events-none" />
            <div className="relative px-7 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Tixtron Wallet</p>
                  <p className="text-[13px] font-medium text-zinc-400 mt-0.5">{orgName ?? '—'}</p>
                </div>
                <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-zinc-800/80 border border-zinc-700 text-zinc-400 shrink-0">{wallet?.plan ?? 'STARTER'}</span>
              </div>
              <div className="flex items-end justify-between gap-4 flex-wrap mt-7 pb-6">
                <p className="text-5xl font-bold tracking-tight text-white tabular-nums">
                  {(wallet?.creditBalance ?? 0).toLocaleString()}<span className="text-sm font-medium text-zinc-600 ml-2">credits</span>
                </p>
                <button
                  onClick={() => setTopUpOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" /> Top up
                </button>
              </div>
            </div>
            <div className="h-[5px] bg-gradient-to-r from-brand-600 to-brand-500" />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500" />
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">Buy credits</p>
            </div>
            <CreditPackGrid
              catalog={catalog}
              checkoutLoading={checkoutLoading}
              buyPack={buyPack}
              bestPackId={bestPackId}
              baselineRate={baselineRate}
              packsByCredits={packsByCredits}
            />
          </div>
        </div>

        {/* Right rail — persistent activity panel, not another stacked section to scroll past */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/30 dark:bg-zinc-900/30 p-4 lg:sticky lg:top-6">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500" />
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">Recent activity</p>
          </div>
          {ledgerItems.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 py-3 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">No activity yet</p>
          ) : (
            <>
              <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
                {ledgerItems.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/60 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{entry.description ?? entry.type}</p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5 tabular-nums">{timeAgo(entry.createdAt)} · balance {entry.balanceAfter.toLocaleString()}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-medium flex items-center gap-1 tabular-nums ${entry.creditsDelta >= 0 ? 'text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
                      {entry.creditsDelta >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : null}
                      {entry.creditsDelta >= 0 ? '+' : ''}{entry.creditsDelta.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
              {ledgerItems.length < ledgerTotal && (
                <button
                onClick={loadMoreLedger}
                disabled={ledgerLoadingMore}
                className="w-full mt-1.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-700 disabled:opacity-50 text-xs font-medium transition-colors"
              >
                {ledgerLoadingMore ? 'Loading…' : `Load more (${ledgerItems.length} of ${ledgerTotal})`}
              </button>
            )}
          </>
        )}
        </div>
      </div>

      {topUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setTopUpOpen(false)}>
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon-192x192.png" alt="" className="w-9 h-9 rounded-[10px] shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Top up your wallet</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Pick a pack — you'll be taken to Paystack to complete payment.</p>
                </div>
              </div>
              <button onClick={() => setTopUpOpen(false)} className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <CreditPackGrid
              catalog={catalog}
              checkoutLoading={checkoutLoading}
              buyPack={buyPack}
              bestPackId={bestPackId}
              baselineRate={baselineRate}
              packsByCredits={packsByCredits}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BillingPageFallback() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="h-8 w-32 rounded bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      <div className="h-28 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingPageFallback />}>
      <BillingPageContent />
    </Suspense>
  );
}
