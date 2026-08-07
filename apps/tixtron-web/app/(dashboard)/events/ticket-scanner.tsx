'use client';

import { useEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { registrationsApi } from '@/lib/api';
import { X, CheckCircle2, AlertTriangle, XCircle, RefreshCw, ScanLine, Keyboard } from 'lucide-react';

const READER_ID = 'ticket-scanner-reader';
const AUTO_RESUME_MS = 1300;

interface CheckInEntry {
  customerName?: string | null;
  customerEmail?: string | null;
  eventName?: string;
  ticketType?: string | null;
  quantity?: number;
  checkedInAt?: string | null;
}
interface CheckInResult {
  outcome: 'ADMITTED' | 'ALREADY_CHECKED_IN' | 'NOT_CONFIRMED' | 'NOT_FOUND' | 'WRONG_EVENT' | 'ERROR';
  entry?: CheckInEntry;
}

const OUTCOME_STYLE: Record<CheckInResult['outcome'], {
  label: string; color: string; flashBg: string; Icon: typeof CheckCircle2; vibrate: number | number[]; tone: number;
}> = {
  ADMITTED:           { label: 'Admitted',           color: '#34D399', flashBg: 'linear-gradient(180deg, rgba(16,185,129,0.28), rgba(16,185,129,0.05) 60%)', Icon: CheckCircle2, vibrate: 45, tone: 880 },
  ALREADY_CHECKED_IN: { label: 'Already checked in', color: '#F5B94D', flashBg: 'linear-gradient(180deg, rgba(245,158,11,0.28), rgba(245,158,11,0.05) 60%)', Icon: AlertTriangle, vibrate: [30, 60, 30], tone: 440 },
  WRONG_EVENT:        { label: 'Wrong event',        color: '#F5B94D', flashBg: 'linear-gradient(180deg, rgba(245,158,11,0.28), rgba(245,158,11,0.05) 60%)', Icon: AlertTriangle, vibrate: [30, 60, 30], tone: 440 },
  NOT_CONFIRMED:      { label: 'Not a valid ticket', color: '#f87171', flashBg: 'linear-gradient(180deg, rgba(239,68,68,0.28), rgba(239,68,68,0.05) 60%)', Icon: XCircle, vibrate: [30, 60, 30], tone: 220 },
  NOT_FOUND:          { label: 'Ticket not found',   color: '#f87171', flashBg: 'linear-gradient(180deg, rgba(239,68,68,0.28), rgba(239,68,68,0.05) 60%)', Icon: XCircle, vibrate: [30, 60, 30], tone: 220 },
  ERROR:              { label: 'Scan failed',        color: '#f87171', flashBg: 'linear-gradient(180deg, rgba(239,68,68,0.28), rgba(239,68,68,0.05) 60%)', Icon: XCircle, vibrate: [30, 60, 30], tone: 220 },
};

// A short synthesized tone — no audio asset to fetch/bundle, and it degrades silently
// if the browser blocks autoplay (door staff already interacted with the page to open this).
function playTone(freq: number) {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch { /* no audio support — visual + haptic feedback still stand */ }
}

export default function TicketScanner({ orgId, open, onClose, productId, eventName, admittedCount, totalCount }: {
  orgId: string; open: boolean; onClose: () => void; productId?: string; eventName?: string;
  admittedCount?: number; totalCount?: number;
}) {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastCodeRef = useRef('');
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scanNext = () => {
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    setResult(null);
    lastCodeRef.current = '';
    (async () => { try { await scannerRef.current?.resume(); } catch { void startCamera(); } })();
  };

  const verify = async (code: string) => {
    if (busyRef.current) return;
    const trimmed = code.trim();
    if (!trimmed || trimmed === lastCodeRef.current) return;
    busyRef.current = true;
    lastCodeRef.current = trimmed;
    try { await scannerRef.current?.pause(true); } catch { /* not scanning */ }
    let outcome: CheckInResult;
    try {
      const res = await registrationsApi.checkIn(orgId, trimmed, productId);
      outcome = res.data as CheckInResult;
    } catch {
      outcome = { outcome: 'ERROR' };
    }
    setResult(outcome);
    const style = OUTCOME_STYLE[outcome.outcome];
    if (navigator.vibrate) navigator.vibrate(style.vibrate);
    playTone(style.tone);
    busyRef.current = false;
    // Continuous scanning — the door doesn't stop for a manual "scan next" tap. A tap on the
    // result itself skips the wait for someone moving faster than the countdown.
    resumeTimerRef.current = setTimeout(scanNext, AUTO_RESUME_MS);
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
    return () => {
      void stopCamera();
      if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.trim()) return;
    await verify(manual);
    setManual('');
  };

  const rs = result ? OUTCOME_STYLE[result.outcome] : null;
  const pct = totalCount ? Math.round(((admittedCount ?? 0) / totalCount) * 100) : null;

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />}
      <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-md bg-zinc-50 dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl transform transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-500/20 flex items-center justify-center shrink-0"><ScanLine className="w-4 h-4 text-brand-400" /></div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{eventName ? `Scan · ${eventName}` : 'Scan tickets'}</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-500">{eventName ? 'Only this event’s tickets are admitted' : 'Point the camera at an attendee’s QR code'}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 shrink-0"><X className="w-4 h-4" /></button>
          </div>

          {/* Persistent live counter — stays visible while continuously scanning */}
          {totalCount !== undefined && totalCount > 0 && (
            <div className="px-5 pt-4">
              <div className="flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/60 px-3.5 py-2.5">
                <span className="text-sm font-semibold text-zinc-900 dark:text-white tabular-nums">
                  <span className="text-emerald-400">{(admittedCount ?? 0).toLocaleString()}</span> / {totalCount.toLocaleString()} admitted
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-500 tabular-nums">{pct}%</span>
              </div>
              <div className="h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mt-2">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Camera viewport — the result flashes full-panel here, readable at a glance in a dark venue */}
            <div className="relative rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black aspect-square">
              <div id={READER_ID} className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />
              {!scanning && !camError && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-400 dark:text-zinc-600 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Starting camera…</div>
              )}
              {camError && (
                <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-zinc-500 dark:text-zinc-500 px-6">{camError}</div>
              )}

              {result && rs && (
                <button
                  onClick={scanNext}
                  className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 cursor-pointer"
                  style={{ background: rs.flashBg }}
                  title="Tap to scan next now"
                >
                  <rs.Icon className="w-11 h-11 mb-2" style={{ color: rs.color }} />
                  <p className="text-lg font-semibold" style={{ color: rs.color }}>{rs.label}</p>
                  {result.entry?.customerName && <p className="text-sm text-zinc-900 dark:text-white mt-1.5 font-medium">{result.entry.customerName}</p>}
                  <p className="text-xs text-zinc-700/80 dark:text-zinc-300/80 mt-0.5">
                    {[result.entry?.eventName, result.entry?.quantity ? `admits ${result.entry.quantity}` : null].filter(Boolean).join(' · ')}
                  </p>
                  {result.entry?.ticketType && (
                    <span className="inline-flex mt-2.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/15 text-zinc-900 dark:text-white">{result.entry.ticketType}</span>
                  )}
                  {result.outcome === 'ALREADY_CHECKED_IN' && result.entry?.checkedInAt && (
                    <p className="text-xs text-amber-200/80 mt-2">Checked in at {new Date(result.entry.checkedInAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                  <p className="absolute bottom-3 left-0 right-0 text-[11px] text-zinc-700/70 dark:text-zinc-300/70">Next scan automatically — tap to skip the wait</p>
                </button>
              )}
            </div>

            {/* Manual fallback */}
            {!result && (
              <form onSubmit={submitManual} className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500"><Keyboard className="w-3.5 h-3.5" /> Or enter the code manually</label>
                <div className="flex gap-2">
                  <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ticket code" className="flex-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600" />
                  <button type="submit" className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium">Verify</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
