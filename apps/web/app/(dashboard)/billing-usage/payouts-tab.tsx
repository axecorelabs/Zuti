'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { orgsApi } from '@/lib/api';
import { useActiveRole } from '@/lib/use-role';

interface PayoutStatus {
  connected: boolean;
  businessName: string | null;
  bankName: string | null;
  accountLast4: string | null;
  accountName: string | null;
  platformFeePercent: number;
}

export default function PayoutsTab({ orgId }: { orgId: string | undefined }) {
  const isOwner = useActiveRole() === 'OWNER';
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);

  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try { const res = await orgsApi.getPayout(orgId); setStatus(res.data); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isOwner) return;
    (async () => { try { const res = await orgsApi.payoutBanks(); setBanks(res.data ?? []); } catch { /* ignore */ } })();
  }, [isOwner]);

  // Resolve the account name once we have a 10-digit number + a bank.
  useEffect(() => {
    setResolvedName(null);
    if (accountNumber.trim().length < 10 || !bankCode) return;
    const t = setTimeout(async () => {
      setResolving(true);
      try { const res = await orgsApi.resolvePayout(accountNumber.trim(), bankCode); setResolvedName(res.data?.accountName ?? null); }
      catch { setResolvedName(null); } finally { setResolving(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [accountNumber, bankCode]);

  const connect = async () => {
    if (!orgId) return;
    if (!businessName.trim() || !bankCode || accountNumber.trim().length < 10) { toast.error('Fill in business name, bank and account number.'); return; }
    setConnecting(true);
    try {
      const res = await orgsApi.setupPayout(orgId, {
        businessName: businessName.trim(),
        settlementBank: bankCode,
        bankName: banks.find((b) => b.code === bankCode)?.name,
        accountNumber: accountNumber.trim(),
      });
      setStatus(res.data);
      toast.success('Payout account connected');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not connect payout account');
    } finally { setConnecting(false); }
  };

  if (loading) return <div className="card p-6"><div className="h-24 rounded-xl bg-zinc-900 animate-pulse" /></div>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0"><Landmark className="w-4.5 h-4.5 text-emerald-400" /></div>
          <div>
            <h2 className="text-sm font-semibold text-white">Payout account</h2>
            <p className="text-xs text-zinc-500 mt-0.5">The bank account that receives your ticket &amp; product sales. Money is paid to you directly by Paystack — Zuti never holds it. Platform fee: {status?.platformFeePercent ?? 5}% per transaction.</p>
          </div>
        </div>

        {status?.connected ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="text-sm font-medium text-emerald-300">Connected</span></div>
            <div className="text-sm text-zinc-300 space-y-0.5">
              <p>{status.businessName}</p>
              <p className="text-zinc-400 text-xs">{status.accountName}{status.bankName ? ` · ${status.bankName}` : ''}{status.accountLast4 ? ` · ****${status.accountLast4}` : ''}</p>
            </div>
            {isOwner && <p className="text-[11px] text-zinc-600 mt-3">To change the account, connect a new one below.</p>}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-amber-300">
            No payout account connected. {isOwner ? 'Connect one below to start selling paid events and products.' : 'Ask an owner to connect one before selling paid events.'}
          </div>
        )}
      </div>

      {isOwner && (
        <div className="card p-6 space-y-4">
          <h3 className="text-sm font-medium text-white">{status?.connected ? 'Connect a different account' : 'Connect your bank account'}</h3>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Business / account name</label>
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Acme Events Ltd" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Bank</label>
            <select value={bankCode} onChange={(e) => setBankCode(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600">
              <option value="">Select bank…</option>
              {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Account number</label>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={10} placeholder="10-digit NUBAN" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" />
            {resolving && <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking account…</p>}
            {resolvedName && <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> {resolvedName}</p>}
          </div>
          <button onClick={connect} disabled={connecting || !resolvedName} className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium">
            {connecting ? 'Connecting…' : 'Connect payout account'}
          </button>
          <p className="text-[11px] text-zinc-600">We confirm the account name with your bank before connecting. Only an owner can change where the money goes.</p>
        </div>
      )}
    </div>
  );
}
