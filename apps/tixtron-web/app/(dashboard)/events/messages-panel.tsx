'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, Send, X, Users, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { registrationsApi, billingApi } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

interface CommsEstimate {
  recipientCount: number; freeRemaining: number; freeApplied: number; chargeableRecipients: number;
  creditsRequired: number; creditBalance: number; sufficient: boolean;
}

interface Announcement {
  id: string; subject: string; segment: string; tierId: string | null;
  totalRecipients: number; sentCount: number; failedCount: number; status: string; automated?: boolean; createdAt: string;
}
interface Counts { all: number; confirmed: number; pending: number; checkedIn: number; tiers: { id: string; name: string; count: number }[] }

const SEGMENT_LABEL: Record<string, string> = { ALL: 'All active', CONFIRMED: 'Confirmed', PENDING: 'Pending payment', CHECKED_IN: 'Checked-in', TIER: 'Tier' };
const STATUS_STYLE: Record<string, string> = {
  SENDING: 'bg-brand-500/15 text-brand-300 border-brand-500/25',
  SENT: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  PARTIAL: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
};

export default function MessagesPanel({ orgId, productId }: { orgId: string; productId: string }) {
  const [history, setHistory] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await registrationsApi.listAnnouncements(orgId, productId); setHistory(res.data ?? []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [orgId, productId]);
  useEffect(() => { void load(); }, [load]);

  // Live: the worker pushes one update when a send finalizes, so the row snaps to SENT/PARTIAL
  // without polling. Patches the matching announcement in place (shared socket).
  useSocketEvent<{ id: string; productId: string; status: string; sentCount: number; failedCount: number; totalRecipients: number }>(
    'announcement:update',
    (p) => {
      if (p.productId !== productId) return;
      setHistory((prev) => prev.map((a) => (a.id === p.id ? { ...a, status: p.status, sentCount: p.sentCount, failedCount: p.failedCount, totalRecipients: p.totalRecipients } : a)));
    },
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-zinc-500 dark:text-zinc-500" /><h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Messages</h3></div>
        <button onClick={() => setComposing(true)} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition-colors">
          <Plus className="w-3.5 h-3.5" /> New message
        </button>
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-600 mb-3">Email attendees about venue, timing or changes. Transactional updates — one message per person.</p>

      {loading ? (
        <div className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      ) : history.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Mail className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mb-2" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No messages sent yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">Keep attendees informed — send your first update.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {history.map((a) => (
            <div key={a.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-800 dark:text-zinc-200 truncate flex-1">{a.subject}</span>
                {a.automated && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-zinc-300/40 dark:bg-zinc-700/40 text-zinc-600 dark:text-zinc-400 border-zinc-400/40 dark:border-zinc-600/40">Auto</span>}
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border capitalize ${STATUS_STYLE[a.status] ?? STATUS_STYLE.SENDING}`}>{a.status.toLowerCase()}</span>
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                {SEGMENT_LABEL[a.segment] ?? a.segment} · {a.sentCount}/{a.totalRecipients} sent{a.failedCount > 0 ? ` · ${a.failedCount} failed` : ''} · {new Date(a.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
          ))}
        </div>
      )}

      {composing && <ComposeModal orgId={orgId} productId={productId} onClose={() => setComposing(false)} onSent={() => { setComposing(false); void load(); }} />}
    </div>
  );
}

function ComposeModal({ orgId, productId, onClose, onSent }: { orgId: string; productId: string; onClose: () => void; onSent: () => void }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [segment, setSegment] = useState('ALL');
  const [tierId, setTierId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [estimate, setEstimate] = useState<CommsEstimate | null>(null);

  useEffect(() => {
    (async () => { try { const res = await registrationsApi.announcementRecipients(orgId, productId); setCounts(res.data); } catch { /* ignore */ } })();
  }, [orgId, productId]);

  const recipientCount = !counts ? 0
    : segment === 'ALL' ? counts.all
    : segment === 'CONFIRMED' ? counts.confirmed
    : segment === 'PENDING' ? counts.pending
    : segment === 'CHECKED_IN' ? counts.checkedIn
    : segment === 'TIER' ? (counts.tiers.find((t) => t.id === tierId)?.count ?? 0)
    : 0;

  // Re-quote the cost whenever the chosen audience size changes.
  useEffect(() => {
    if (recipientCount === 0) { setEstimate(null); return; }
    let cancelled = false;
    billingApi.commsEstimate(orgId, recipientCount).then((res) => { if (!cancelled) setEstimate(res.data); }).catch(() => { if (!cancelled) setEstimate(null); });
    return () => { cancelled = true; };
  }, [orgId, recipientCount]);

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && recipientCount > 0 && (segment !== 'TIER' || tierId) && !sending && (!estimate || estimate.sufficient);

  const send = async () => {
    const costNote = estimate && estimate.chargeableRecipients > 0
      ? ` ${estimate.freeApplied} free, ${estimate.chargeableRecipients} will cost ${estimate.creditsRequired} credits.`
      : ' Fully covered by this month\'s free allotment.';
    if (!confirm(`Email ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}?${costNote} This can't be unsent.`)) return;
    setSending(true);
    try {
      const res = await registrationsApi.createAnnouncement(orgId, productId, { segment, tierId: segment === 'TIER' ? tierId : undefined, subject: subject.trim(), body: body.trim() });
      if (res.data?.outcome === 'NO_RECIPIENTS') { toast.error('No attendees match that audience.'); setSending(false); return; }
      toast.success(`Sending to ${res.data?.totalRecipients ?? recipientCount} people`);
      onSent();
    } catch (e: any) {
      if (e?.response?.data?.code === 'INSUFFICIENT_CREDITS') {
        toast.error('Not enough credits — top up in Billing to reach everyone in this audience.');
      } else {
        toast.error(e?.response?.data?.message ?? 'Could not send');
      }
      setSending(false);
    }
  };

  const opt = (val: string, label: string, count: number) => (
    <label className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${segment === val ? 'border-brand-500/50 bg-brand-500/5' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}>
      <span className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
        <input type="radio" name="segment" checked={segment === val} onChange={() => setSegment(val)} className="accent-brand-500" />
        {label}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-500">{count}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">New message</h3>
          <button onClick={onClose} className="text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1.5">Send to</label>
            <div className="grid grid-cols-2 gap-1.5">
              {opt('ALL', 'All active', counts?.all ?? 0)}
              {opt('CONFIRMED', 'Confirmed', counts?.confirmed ?? 0)}
              {opt('PENDING', 'Pending payment', counts?.pending ?? 0)}
              {opt('CHECKED_IN', 'Checked-in', counts?.checkedIn ?? 0)}
            </div>
            {(counts?.tiers.length ?? 0) > 0 && (
              <label className={`mt-1.5 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${segment === 'TIER' ? 'border-brand-500/50 bg-brand-500/5' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}>
                <span className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                  <input type="radio" name="segment" checked={segment === 'TIER'} onChange={() => setSegment('TIER')} className="accent-brand-500" />
                  By tier
                </span>
                <select value={tierId} onChange={(e) => { setTierId(e.target.value); setSegment('TIER'); }} className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none">
                  <option value="">Select…</option>
                  {counts?.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.count})</option>)}
                </select>
              </label>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} placeholder="Doors open at 6 — bring your QR"
              className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">Message</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={5000} placeholder="Hi — quick heads up about the event…"
              className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 resize-y" />
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-600">Transactional event update. Sent from your organization&apos;s name to people who registered.</p>
          {estimate && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
              {estimate.chargeableRecipients === 0
                ? `Fully covered by this month's free allotment (${estimate.freeRemaining} of 50 left).`
                : estimate.sufficient
                  ? `${estimate.freeApplied} free, ${estimate.chargeableRecipients} will cost ${estimate.creditsRequired} credits.`
                  : `Not enough credits — need ${estimate.creditsRequired}, have ${estimate.creditBalance}.`}
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
            {recipientCount === 0 ? <><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> No recipients</> : <><Users className="w-3.5 h-3.5" /> Sending to <span className="text-zinc-800 dark:text-zinc-200 font-medium">{recipientCount}</span> {recipientCount === 1 ? 'person' : 'people'}</>}
          </span>
          <button onClick={send} disabled={!canSend} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium">
            <Send className="w-4 h-4" /> {sending ? 'Sending…' : estimate && !estimate.sufficient ? 'Not enough credits' : `Send${recipientCount > 0 ? ` to ${recipientCount}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
