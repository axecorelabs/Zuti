'use client';

import { useEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { registrationsApi } from '@/lib/api';
import { X, CheckCircle2, AlertTriangle, XCircle, RefreshCw, ScanLine, Keyboard } from 'lucide-react';

const READER_ID = 'ticket-scanner-reader';

interface CheckInEntry {
  customerName?: string | null;
  customerEmail?: string | null;
  eventName?: string;
  ticketType?: string | null;
  quantity?: number;
  checkedInAt?: string | null;
}
interface CheckInResult {
  outcome: 'ADMITTED' | 'ALREADY_CHECKED_IN' | 'NOT_CONFIRMED' | 'NOT_FOUND' | 'ERROR';
  entry?: CheckInEntry;
}

const OUTCOME_STYLE: Record<CheckInResult['outcome'], { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle2 }> = {
  ADMITTED:           { label: 'Admitted',            color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', Icon: CheckCircle2 },
  ALREADY_CHECKED_IN: { label: 'Already checked in',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', Icon: AlertTriangle },
  NOT_CONFIRMED:      { label: 'Not a valid ticket',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', Icon: XCircle },
  NOT_FOUND:          { label: 'Ticket not found',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', Icon: XCircle },
  ERROR:              { label: 'Scan failed',         color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', Icon: XCircle },
};

export default function TicketScanner({ orgId, open, onClose }: { orgId: string; open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastCodeRef = useRef('');

  const verify = async (code: string) => {
    if (busyRef.current) return;
    const trimmed = code.trim();
    if (!trimmed || trimmed === lastCodeRef.current) return;
    busyRef.current = true;
    lastCodeRef.current = trimmed;
    try { await scannerRef.current?.pause(true); } catch { /* not scanning */ }
    try {
      const res = await registrationsApi.checkIn(orgId, trimmed);
      setResult(res.data as CheckInResult);
    } catch {
      setResult({ outcome: 'ERROR' });
    } finally {
      busyRef.current = false;
    }
  };

  const startCamera = async () => {
    setCamError(null);
    try {
      const { Html5Qrcode } = await import('html5-qrcode'); // browser-only; load lazily
      const scanner = new Html5Qrcode(READER_ID, { verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 232, height: 232 } },
        (decoded) => { void verify(decoded); },
        () => { /* ignore per-frame decode misses */ },
      );
      setScanning(true);
    } catch {
      setScanning(false);
      setCamError('Camera unavailable — grant access, or enter the ticket code manually below.');
    }
  };

  const stopCamera = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try { await s.stop(); } catch { /* already stopped */ }
      try { s.clear(); } catch { /* noop */ }
    }
    setScanning(false);
  };

  useEffect(() => {
    if (open) { void startCamera(); }
    return () => { void stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scanNext = async () => {
    setResult(null);
    lastCodeRef.current = '';
    try { await scannerRef.current?.resume(); } catch { void startCamera(); }
  };

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.trim()) return;
    await verify(manual);
    setManual('');
  };

  const rs = result ? OUTCOME_STYLE[result.outcome] : null;

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />}
      <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl transform transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/20 flex items-center justify-center"><ScanLine className="w-4 h-4 text-blue-400" /></div>
              <div>
                <h2 className="text-sm font-semibold text-white">Scan tickets</h2>
                <p className="text-xs text-zinc-500">Point the camera at an attendee&apos;s QR code</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Camera viewport */}
            <div className="relative rounded-2xl overflow-hidden border border-zinc-800 bg-black aspect-square">
              <div id={READER_ID} className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />
              {!scanning && !camError && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Starting camera…</div>
              )}
              {camError && (
                <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-zinc-500 px-6">{camError}</div>
              )}
            </div>

            {/* Result */}
            {result && rs && (
              <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: rs.bg, border: `1px solid ${rs.border}` }}>
                <rs.Icon className="w-9 h-9 mx-auto mb-2" style={{ color: rs.color }} />
                <p className="text-base font-semibold" style={{ color: rs.color }}>{rs.label}</p>
                {result.entry?.customerName && <p className="text-sm text-white mt-1.5 font-medium">{result.entry.customerName}</p>}
                <p className="text-xs text-zinc-400 mt-0.5">
                  {[result.entry?.eventName, result.entry?.ticketType, result.entry?.quantity ? `admits ${result.entry.quantity}` : null].filter(Boolean).join(' · ')}
                </p>
                {result.outcome === 'ALREADY_CHECKED_IN' && result.entry?.checkedInAt && (
                  <p className="text-xs text-amber-400/80 mt-1">Checked in at {new Date(result.entry.checkedInAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                )}
                <button onClick={scanNext} className="mt-4 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors">Scan next</button>
              </div>
            )}

            {/* Manual fallback */}
            {!result && (
              <form onSubmit={submitManual} className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs text-zinc-500"><Keyboard className="w-3.5 h-3.5" /> Or enter the code manually</label>
                <div className="flex gap-2">
                  <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ticket code" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" />
                  <button type="submit" className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">Verify</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
