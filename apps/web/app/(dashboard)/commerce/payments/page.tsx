'use client';

import { useEffect, useState } from 'react';
import { commerceApi, orgApi, resolveOrgId } from '@/lib/api';
import { CheckCircle2, Clock, XCircle, CreditCard } from 'lucide-react';

type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED';

interface Payment {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  paidAt: string | null;
  createdAt: string;
  orderId: string;
  order: {
    id: string;
    customerName: string | null;
    customerEmail: string | null;
    store: { id: string; name: string };
  };
}

interface CurrencySummary {
  receivedMinor: number;
  pendingMinor: number;
  count: number;
}

function formatAmount(minor: number, currency: string) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CONFIG: Record<PaymentStatus, { label: string; color: string; icon: React.FC<any> }> = {
  SUCCESS: { label: 'Paid', color: 'text-emerald-400 bg-emerald-950 border-emerald-900', icon: CheckCircle2 },
  PENDING: { label: 'Pending', color: 'text-amber-400 bg-amber-950 border-amber-900', icon: Clock },
  FAILED: { label: 'Failed', color: 'text-red-400 bg-red-950 border-red-900', icon: XCircle },
  ABANDONED: { label: 'Abandoned', color: 'text-zinc-500 bg-zinc-900 border-zinc-800', icon: XCircle },
};

export default function PaymentsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<Record<string, CurrencySummary>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function setup() {
      const orgs = (await orgApi.listSummary()).data as Array<{ id: string }>;
      const resolved = resolveOrgId(orgs as any);
      if (!resolved) return;
      setOrgId(resolved);

      setLoading(true);
      try {
        const res = await commerceApi.listPayments(resolved);
        setPayments(res.data?.payments ?? []);
        setSummary(res.data?.summary ?? {});
      } finally {
        setLoading(false);
      }
    }
    setup();
  }, []);

  const currencies = Object.keys(summary);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Payments</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">All payment transactions across your stores.</p>
      </div>

      {/* Summary cards */}
      {currencies.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {currencies.map((cur) => {
            const s = summary[cur];
            return (
              <>
                <div key={`recv-${cur}`} className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500 font-light">Total received</p>
                    <div className="w-7 h-7 rounded-lg bg-emerald-950 flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                  </div>
                  <p className="text-2xl font-brand font-semibold text-white">{formatAmount(s.receivedMinor, cur)}</p>
                  <p className="mt-1 text-xs text-zinc-600 font-light">{cur} · successful payments</p>
                </div>

                <div key={`pend-${cur}`} className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500 font-light">Pending</p>
                    <div className="w-7 h-7 rounded-lg bg-amber-950 flex items-center justify-center">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                  </div>
                  <p className="text-2xl font-brand font-semibold text-white">{formatAmount(s.pendingMinor, cur)}</p>
                  <p className="mt-1 text-xs text-zinc-600 font-light">{cur} · awaiting completion</p>
                </div>

                <div key={`count-${cur}`} className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500 font-light">Total transactions</p>
                    <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <CreditCard className="w-3.5 h-3.5 text-zinc-400" />
                    </div>
                  </div>
                  <p className="text-2xl font-brand font-semibold text-white">{s.count}</p>
                  <p className="mt-1 text-xs text-zinc-600 font-light">{cur} · all statuses</p>
                </div>
              </>
            );
          })}
        </div>
      )}

      {/* Payment list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-normal text-white">Transaction history</h2>
        </div>

        {loading ? (
          <div className="p-8 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-zinc-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center">
            <CreditCard className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-600 font-light">No payment transactions yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-5 py-3 text-xs font-normal text-zinc-500">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-normal text-zinc-500">Reference</th>
                  <th className="text-left px-5 py-3 text-xs font-normal text-zinc-500">Customer</th>
                  <th className="text-left px-5 py-3 text-xs font-normal text-zinc-500">Store</th>
                  <th className="text-right px-5 py-3 text-xs font-normal text-zinc-500">Amount</th>
                  <th className="text-right px-5 py-3 text-xs font-normal text-zinc-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.ABANDONED;
                  const Icon = cfg.icon;
                  return (
                    <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors">
                      <td className="px-5 py-3.5 text-xs text-zinc-500 font-light whitespace-nowrap">
                        {formatDate(p.createdAt)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-[11px] text-zinc-400">{p.reference}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-white font-light">{p.order.customerName ?? '—'}</p>
                        {p.order.customerEmail && (
                          <p className="text-[11px] text-zinc-600">{p.order.customerEmail}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs text-zinc-400 font-light">{p.order.store.name}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-sm text-white font-light tabular-nums">
                          {formatAmount(p.amountMinor, p.currency)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={`inline-flex items-center gap-1 text-[11px] border rounded-full px-2 py-0.5 ${cfg.color}`}>
                          <Icon className="w-2.5 h-2.5" />
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
