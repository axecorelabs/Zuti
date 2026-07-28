'use client';

import { useEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { ScanLine, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Keyboard, ShieldOff } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const READER_ID = 'scan-session-reader';

type Resolve =
  | { valid: false; reason: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' }
  | { valid: true; eventName: string; venue: string | null; eventDate: string | null; label: string | null; expiresAt: string };

type Outcome = 'ADMITTED' | 'ALREADY_CHECKED_IN' | 'NOT_CONFIRMED' | 'NOT_FOUND' | 'WRONG_EVENT' | 'SESSION_INVALID' | 'ERROR';
interface CheckInResult { outcome: Outcome; entry?: { customerName: string | null; ticketType: string | null; checkedInAt: string | null } }

const STYLE: Record<Outcome, { bg: string; border: string; color: string; icon: any; title: string }> = {
  ADMITTED: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', color: '#34d399', icon: CheckCircle2, title: 'Admitted' },
  ALREADY_CHECKED_IN: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', color: '#fbbf24', icon: AlertTriangle, title: 'Already checked in' },
  NOT_CONFIRMED: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', color: '#fbbf24', icon: AlertTriangle, title: 'Not confirmed / unpaid' },
  NOT_FOUND: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: '#f87171', icon: XCircle, title: 'Ticket not found' },
  WRONG_EVENT: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: '#f87171', icon: XCircle, title: 'Ticket for another event' },
  SESSION_INVALID: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: '#f87171', icon: ShieldOff, title: 'Scanning link no longer valid' },
  ERROR: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: '#f87171', icon: XCircle, title: 'Something went wrong' },
};

export default function ScanSessionPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [session, setSession] = useState<Resolve | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [manual, setManual] = useState('');
  const [dead, setDead] = useState(false); // session died mid-use

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastCodeRef = useRef('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/public/scan/${token}`);
        const data = (await res.json()) as Resolve;
        setSession(data);
      } catch {
        setSession({ valid: false, reason: 'NOT_FOUND' });
      } finally { setLoading(false); }
    })();
  }, [token]);

  const verify = async (code: string) => {
    if (busyRef.current || dead) return;
    const trimmed = code.trim();
    if (!trimmed || trimmed === lastCodeRef.current) return;
    busyRef.current = true;
    lastCodeRef.current = trimmed;
    try { await scannerRef.current?.pause(true); } catch { /* not scanning */ }
    try {
      const res = await fetch(`${API_URL}/api/public/scan/${token}/checkin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json()) as CheckInResult;
      setResult(data);
      if (data.outcome === 'SESSION_INVALID') { setDead(true); void stopCamera(); }
    } catch {
      setResult({ outcome: 'ERROR' });
    } finally { busyRef.current = false; }
  };

  const startCamera = async () => {
    setCamError(null);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(READER_ID, { verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 232, height: 232 } },
        (decoded) => { void verify(decoded); },
        () => { /* ignore decode misses */ },
      );
      setScanning(true);
    } catch {
      setScanning(false);
      setCamError('Camera unavailable — grant access, or type the ticket code below.');
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
    if (session?.valid && !dead) { void startCamera(); }
    return () => { void stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.valid, dead]);

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

  // ── Render states ───────────────────────────────────────────────────────────
  if (loading) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
  }

  if (!session || !session.valid) {
    const reason = session && !session.valid ? session.reason : 'NOT_FOUND';
    const msg = reason === 'EXPIRED' ? 'This scanning link has expired.' : reason === 'REVOKED' ? 'This scanning link has been turned off by the organizer.' : 'This scanning link is not valid.';
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center">
        <ShieldOff className="w-12 h-12 text-zinc-700 mb-4" />
        <h1 className="text-lg font-semibold text-white">Link unavailable</h1>
        <p className="text-sm text-zinc-500 mt-2 max-w-xs">{msg}</p>
        <p className="text-xs text-zinc-700 mt-6">Ask the event organizer for a fresh link.</p>
      </div>
    );
  }

  const rs = result ? STYLE[result.outcome] : null;
  const eventDate = session.eventDate ? new Date(session.eventDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-md px-5 py-6">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center shrink-0"><ScanLine className="w-4.5 h-4.5 text-blue-400" /></div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">{session.eventName}</h1>
            <p className="text-xs text-zinc-500 truncate">
              {session.label ? `${session.label} · ` : ''}{eventDate ?? 'Check-in'} · only this event’s tickets are admitted
            </p>
          </div>
        </div>

        {dead ? (
          <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: STYLE.SESSION_INVALID.bg, border: `1px solid ${STYLE.SESSION_INVALID.border}` }}>
            <ShieldOff className="w-8 h-8 mx-auto mb-2" style={{ color: STYLE.SESSION_INVALID.color }} />
            <p className="text-sm font-semibold" style={{ color: STYLE.SESSION_INVALID.color }}>Scanning link no longer valid</p>
            <p className="text-xs text-zinc-500 mt-1">It expired or was turned off. Ask the organizer for a new link.</p>
          </div>
        ) : (
          <>
            {/* Camera */}
            <div className="relative rounded-2xl overflow-hidden border border-zinc-800 bg-black aspect-square">
              <div id={READER_ID} className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />
              {!scanning && !camError && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Starting camera…</div>
              )}
              {camError && <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-zinc-500 px-6">{camError}</div>}
            </div>

            {/* Result */}
            {result && rs && (
              <div className="mt-4 rounded-2xl p-5 text-center" style={{ backgroundColor: rs.bg, border: `1px solid ${rs.border}` }}>
                <rs.icon className="w-8 h-8 mx-auto mb-2" style={{ color: rs.color }} />
                <p className="text-sm font-semibold" style={{ color: rs.color }}>{rs.title}</p>
                {result.entry?.customerName && <p className="text-base text-white font-medium mt-1">{result.entry.customerName}</p>}
                {result.entry?.ticketType && <p className="text-xs text-zinc-400 mt-0.5">{result.entry.ticketType}</p>}
                {result.outcome === 'ALREADY_CHECKED_IN' && result.entry?.checkedInAt && (
                  <p className="text-xs text-zinc-500 mt-1">Checked in {new Date(result.entry.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                )}
                <button onClick={scanNext} className="mt-4 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors">Scan next</button>
              </div>
            )}

            {/* Manual fallback */}
            <form onSubmit={submitManual} className="mt-4">
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5"><Keyboard className="w-3.5 h-3.5" /> QR won’t scan? Type the ticket code</label>
              <div className="flex gap-2">
                <input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Ticket code"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                />
                <button type="submit" disabled={!manual.trim()} className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium">Check in</button>
              </div>
            </form>
          </>
        )}

        <p className="text-center text-[11px] text-zinc-700 mt-8">Powered by Zuti · admit-only link</p>
      </div>
    </div>
  );
}
