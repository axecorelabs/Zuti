'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Plus, Copy, Check, Ban, Clock, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { registrationsApi } from '@/lib/api';

interface ScanSession {
  id: string; label: string | null; expiresAt: string; revokedAt: string | null; createdAt: string;
  status: 'active' | 'expired' | 'revoked'; url: string;
}

const STATUS_STYLE: Record<ScanSession['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  expired: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40',
  revoked: 'bg-red-500/10 text-red-300 border-red-500/25',
};

/**
 * OWNER/ADMIN-only panel for minting temporary public check-in links for an event. Door/volunteer
 * staff open the URL and scan — no account. Each link is event-scoped, expiring, and revocable.
 */
export default function ScanSessionsPanel({ orgId, productId }: { orgId: string; productId: string }) {
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await registrationsApi.listScanSessions(orgId, productId);
      setSessions(res.data ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [orgId, productId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await registrationsApi.createScanSession(orgId, productId, {
        label: label.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      const url: string = res.data?.url;
      if (url) { try { await navigator.clipboard.writeText(url); toast.success('Link created & copied'); } catch { toast.success('Link created'); } }
      setLabel(''); setExpiresAt(''); setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not create link');
    } finally { setCreating(false); }
  };

  const copy = async (s: ScanSession) => {
    try { await navigator.clipboard.writeText(s.url); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1500); } catch { /* noop */ }
  };

  const revoke = async (s: ScanSession) => {
    if (!confirm('Turn off this scanning link now? Anyone using it will immediately lose access.')) return;
    try { await registrationsApi.revokeScanSession(orgId, s.id); toast.success('Link revoked'); await load(); }
    catch { toast.error('Could not revoke'); }
  };

  return (
    <div className="mt-6 border-t border-zinc-800/60 pt-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-200">Scanning links</h3>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New link
        </button>
      </div>
      <p className="text-xs text-zinc-600 mb-3">Temporary public links so door staff can scan tickets without an account. Event-scoped, expiring, admit-only.</p>

      {showForm && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 mb-3 space-y-2.5">
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Label (optional)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Front door" maxLength={60}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Expires (optional — defaults to event end + 6h)</label>
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
            <button onClick={create} disabled={creating} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium">
              {creating ? 'Creating…' : 'Create link'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-12 rounded-xl bg-zinc-900 animate-pulse" />
      ) : sessions.length === 0 ? (
        <p className="text-xs text-zinc-600 py-2">No scanning links yet.</p>
      ) : (
        <div className="space-y-1.5">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200 truncate">{s.label || 'Scanning link'}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border capitalize ${STATUS_STYLE[s.status]}`}>{s.status}</span>
                </div>
                <p className="text-[11px] text-zinc-600 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" /> {s.status === 'revoked' ? 'Revoked' : (new Date(s.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Expires')} {new Date(s.revokedAt ?? s.expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
              {s.status === 'active' && (
                <>
                  <button onClick={() => copy(s)} title="Copy link" className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800">
                    {copiedId === s.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => revoke(s)} title="Revoke link" className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800"><Ban className="w-3.5 h-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
