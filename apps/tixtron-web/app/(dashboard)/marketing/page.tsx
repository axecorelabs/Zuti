'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Megaphone, Send, ArrowUpRight, Sparkles, CalendarDays, MapPin, Ticket,
  Wallet, Users2, History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { botsApi, registrationsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useActiveRole } from '@/lib/use-role';

interface CommandBot { id: string; botType: 'AI' | 'COMMAND'; webhookSet: boolean }
interface EventOption {
  id: string; name: string; bannerUrl: string | null; flierUrl: string | null;
  eventDate: string | null; eventEndDate: string | null; eventDateHasTime: boolean;
  venue: string | null; currency: string; priceMinor: number | null; isFree: boolean;
  isPublic: boolean; slug: string | null;
  ticketTypes: Array<{ priceMinor: number | null }>;
}
interface CommsEstimate {
  recipientCount: number; freeRemaining: number; freeApplied: number; chargeableRecipients: number;
  creditsRequired: number; creditBalance: number; sufficient: boolean;
}
interface Broadcast {
  id: string; status: 'SENDING' | 'SENT' | 'FAILED';
  message: string; imageUrl: string | null; creditsChargedUnits: number; freeRecipientsApplied: number;
  recipientCount: number; sentCount: number; failedCount: number; createdAt: string;
}

const MAX_LEN = 2000;
const STATUS_META: Record<Broadcast['status'], { label: string; cls: string }> = {
  SENDING: { label: 'Sending…', cls: 'bg-brand-500/15 text-brand-300 border-brand-500/25' },
  SENT: { label: 'Sent', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
  FAILED: { label: 'Failed', cls: 'bg-red-500/15 text-red-300 border-red-500/25' },
};

function formatEventDate(e: EventOption): string | null {
  if (!e.eventDate) return null;
  const start = new Date(e.eventDate);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const startStr = start.toLocaleDateString('en-GB', opts);
  const startTime = e.eventDateHasTime ? `, ${start.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}` : '';
  const end = e.eventEndDate ? new Date(e.eventEndDate) : null;
  if (!end || end.toDateString() === start.toDateString()) return `${startStr}${startTime}`;
  return `${startStr} – ${end.toLocaleDateString('en-GB', opts)}`;
}

function priceLabel(e: EventOption): string {
  const prices = e.ticketTypes.length > 0 ? e.ticketTypes.map((t) => t.priceMinor ?? 0) : [e.priceMinor ?? 0];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === 0 && max === 0) return 'Free';
  const money = (m: number) => `${e.currency} ${(m / 100).toLocaleString()}`;
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
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

function ChartTooltip({ active, payload, label, suffix }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg">
      {label ? <p className="text-zinc-500 dark:text-zinc-500 mb-0.5">{label}</p> : null}
      <p className="text-zinc-900 dark:text-white font-medium">{p.name ? `${p.name}: ` : ''}{p.value}{suffix ?? ''}</p>
    </div>
  );
}

function MarketingPageContent() {
  const { activeOrgId } = useAuthStore();
  const searchParams = useSearchParams();
  const role = useActiveRole();
  const isOwner = role === 'OWNER' || role === 'ADMIN';

  const [bot, setBot] = useState<CommandBot | null>(null);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<CommsEstimate | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [totals, setTotals] = useState({ broadcastCount: 0, delivered: 0, creditsSpent: 0 });
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<'boost' | 'plain'>('plain');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const pollingRef = useRef(false);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const botsRes = await botsApi.list(activeOrgId);
      const found = (botsRes.data as CommandBot[]).find((b) => b.botType === 'COMMAND') ?? null;
      setBot(found);
      if (found) {
        const [recRes, estRes, eventsRes, broadcastsRes] = await Promise.all([
          botsApi.marketingRecipients(activeOrgId, found.id),
          botsApi.marketingCostEstimate(activeOrgId, found.id),
          registrationsApi.listProducts(activeOrgId),
          botsApi.listBroadcasts(activeOrgId, found.id),
        ]);
        setRecipientCount(recRes.data.count);
        setEstimate(estRes.data);
        setEvents((eventsRes.data as EventOption[]).filter((e) => e.isPublic && e.slug));
        setBroadcasts(broadcastsRes.data.broadcasts);
        setTotals(broadcastsRes.data.totals);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [activeOrgId]);
  useEffect(() => { void load(); }, [load]);

  // Poll while a broadcast is actively sending, so counts + history update live.
  const pollUntilDone = useCallback(async (botId: string) => {
    if (!activeOrgId || pollingRef.current) return;
    pollingRef.current = true;
    try {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const res = await botsApi.listBroadcasts(activeOrgId, botId);
        setBroadcasts(res.data.broadcasts);
        setTotals(res.data.totals);
        const stillSending = (res.data.broadcasts as Broadcast[]).some((b) => b.status === 'SENDING');
        if (!stillSending) break;
      }
      const recRes = await botsApi.marketingRecipients(activeOrgId, botId);
      setRecipientCount(recRes.data.count);
      const estRes = await botsApi.marketingCostEstimate(activeOrgId, botId);
      setEstimate(estRes.data);
    } finally {
      pollingRef.current = false;
    }
  }, [activeOrgId]);

  // Deep link from the Events page's "Boost" button.
  useEffect(() => {
    const boostId = searchParams.get('boost');
    if (boostId) { setMode('boost'); setSelectedEventId(boostId); }
  }, [searchParams]);

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;
  const heroImage = selectedEvent?.bannerUrl ?? selectedEvent?.flierUrl ?? null;

  const sentBroadcasts = broadcasts.filter((b) => b.status === 'SENT');
  const deliveredChartData = [...sentBroadcasts].reverse().slice(-10).map((b, i) => ({
    label: new Date(b.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    delivered: b.sentCount,
    key: `${b.id}-${i}`,
  }));
  const totalSent = sentBroadcasts.reduce((s, b) => s + b.sentCount, 0);
  const totalFailed = sentBroadcasts.reduce((s, b) => s + b.failedCount, 0);
  const deliveryData = [
    { name: 'Delivered', value: totalSent, color: '#10b981' },
    { name: 'Failed', value: totalFailed, color: '#71717a' },
  ].filter((d) => d.value > 0);

  const send = async () => {
    if (!activeOrgId || !bot) return;
    if (mode === 'boost' && !selectedEventId) { toast.error('Pick an event to boost.'); return; }
    const trimmed = message.trim();
    if (mode === 'plain' && !trimmed) { toast.error('Write a message first.'); return; }
    if (!recipientCount) { toast.error('No subscribers to send to yet.'); return; }

    const chargeable = estimate?.chargeableRecipients ?? 0;
    const freeApplied = estimate?.freeApplied ?? recipientCount;
    const confirmMsg = chargeable === 0
      ? `Send this to ${recipientCount} subscriber${recipientCount === 1 ? '' : 's'} on Telegram? Fully covered by this month's free allotment.`
      : `Send this to ${recipientCount} subscriber${recipientCount === 1 ? '' : 's'}? ${freeApplied} free, ${chargeable} will cost ${estimate?.creditsRequired} credits.`;
    if (!confirm(confirmMsg)) return;

    setSending(true);
    try {
      await botsApi.createBroadcast(activeOrgId, bot.id, {
        message: trimmed || (selectedEvent ? `${selectedEvent.name} — tickets available now.` : ''),
        eventId: mode === 'boost' ? selectedEventId : undefined,
      });
      toast.success('Sending…');
      setMessage('');
      setSelectedEventId('');
      await load();
      await pollUntilDone(bot.id);
    } catch (e: any) {
      if (e?.response?.data?.code === 'INSUFFICIENT_CREDITS') {
        toast.error('Not enough credits — top up in Billing to reach everyone on this list.');
      } else {
        toast.error(e?.response?.data?.message ?? 'Could not send');
      }
    } finally { setSending(false); }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-40 rounded bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
        <div className="h-40 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Marketing</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Message subscribers on Telegram.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center">
          <Megaphone className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No Telegram bot connected</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1 mb-4">Connect a bot first — customers who opt in through it become marketing subscribers here.</p>
          <Link href="/bot" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium">
            Go to Bot <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Marketing</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Message everyone who&apos;s opted in to hear from your bot.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-3.5">
          <Megaphone className="w-4 h-4 text-zinc-600 dark:text-zinc-400 mb-2" />
          <p className="text-base font-semibold text-zinc-900 dark:text-white tabular-nums">{totals.broadcastCount}</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5">Broadcasts sent</p>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-3.5">
          <Users2 className="w-4 h-4 text-brand-400 mb-2" />
          <p className="text-base font-semibold text-zinc-900 dark:text-white tabular-nums">{totals.delivered.toLocaleString()}</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5">Messages delivered</p>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-3.5">
          <Wallet className="w-4 h-4 text-zinc-600 dark:text-zinc-400 mb-2" />
          <p className="text-base font-semibold text-zinc-900 dark:text-white tabular-nums">{totals.creditsSpent.toLocaleString()}</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5">Credits spent</p>
        </div>
      </div>

      {sentBroadcasts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">Delivered per broadcast</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={deliveredChartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: '#687177', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: '#687177', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip content={<ChartTooltip suffix=" delivered" />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="delivered" fill="#FF6A00" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 p-4">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">Delivery success</p>
            {deliveryData.length === 0 ? (
              <div className="h-[160px] flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-600">No sends yet</div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-[120px] h-[160px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={deliveryData} dataKey="value" nameKey="name" innerRadius={36} outerRadius={60} paddingAngle={2} stroke="none">
                        {deliveryData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5 min-w-0">
                  {deliveryData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs gap-2">
                      <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 truncate">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                        {d.name}
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-300 font-medium shrink-0">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/60 border border-zinc-300/40 dark:border-zinc-700/40 flex items-center justify-center shrink-0">
              <Megaphone className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            </div>
            <div>
              <p className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight tabular-nums">{recipientCount ?? 0}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">subscriber{recipientCount === 1 ? '' : 's'} opted in</p>
            </div>
          </div>
          {estimate && (
            <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
              estimate.chargeableRecipients === 0
                ? 'bg-brand-500/15 text-brand-300 border-brand-500/25'
                : estimate.sufficient ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700' : 'bg-red-500/15 text-red-300 border-red-500/25'
            }`}>
              {estimate.chargeableRecipients === 0
                ? 'Free this month'
                : estimate.sufficient
                  ? `${estimate.creditsRequired} credits for this send`
                  : 'Not enough credits'}
            </span>
          )}
        </div>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-3">
          Only people who explicitly replied /subscribe are counted. Every message automatically includes an unsubscribe instruction.
          {estimate && ` ${estimate.freeRemaining} of 50 free recipients left this month.`}
        </p>
      </div>

      {!recipientCount ? (
        <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No subscribers yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">People are offered the chance to subscribe after using /events on your bot. Come back once you have some.</p>
        </div>
      ) : isOwner ? (
        <div className="card p-5 space-y-4">
          <div className="flex gap-1.5">
            <button
              onClick={() => setMode('boost')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${mode === 'boost' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-800'}`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Boost an event
            </button>
            <button
              onClick={() => setMode('plain')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${mode === 'plain' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-800'}`}
            >
              Plain message
            </button>
          </div>

          {mode === 'boost' ? (
            <>
              {events.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-600 py-3 text-center">No public events to boost yet — publish an event first.</p>
              ) : (
                <div>
                  <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1.5">Event</label>
                  <select
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                  >
                    <option value="">Select an event…</option>
                    {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              )}

              {selectedEvent && (
                <div>
                  <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1.5">Add a one-line hook (optional)</label>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                    placeholder="Tickets moving fast — grab yours before prices go up!"
                    className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                  />
                </div>
              )}

              {selectedEvent && (
                <div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-1.5">Preview</p>
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-[#17212b]">
                    {heroImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={heroImage} alt="" className="w-full h-40 object-cover" />
                    )}
                    <div className="p-3 space-y-1.5">
                      <p className="text-sm font-semibold text-white">{selectedEvent.name}</p>
                      {formatEventDate(selectedEvent) && (
                        <p className="text-xs text-zinc-300 flex items-center gap-1.5"><CalendarDays className="w-3 h-3 text-zinc-500" /> {formatEventDate(selectedEvent)}</p>
                      )}
                      {selectedEvent.venue && (
                        <p className="text-xs text-zinc-300 flex items-center gap-1.5"><MapPin className="w-3 h-3 text-zinc-500" /> {selectedEvent.venue}</p>
                      )}
                      <p className="text-xs text-zinc-300 flex items-center gap-1.5"><Ticket className="w-3 h-3 text-zinc-500" /> {priceLabel(selectedEvent)}</p>
                      {message.trim() && <p className="text-xs text-zinc-400 pt-1">{message.trim()}</p>}
                      <div className="pt-2">
                        <span className="inline-block text-[11px] px-3 py-1.5 rounded-lg bg-[#2b5278] text-brand-200">Get Tickets ↗</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
                rows={5}
                placeholder="New event just dropped — tickets are live!"
                className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 resize-none"
              />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-1.5">{message.length}/{MAX_LEN} · will end with &quot;Reply /unsubscribe to stop these messages.&quot;</p>
            </div>
          )}

          <button
            onClick={send}
            disabled={sending || !estimate?.sufficient || (mode === 'boost' ? !selectedEventId : !message.trim())}
            className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
          >
            <Send className="w-3.5 h-3.5" />
            {sending
              ? 'Sending…'
              : !estimate?.sufficient
                ? 'Not enough credits'
                : estimate.chargeableRecipients === 0
                  ? `Send free to ${recipientCount} subscriber${recipientCount === 1 ? '' : 's'}`
                  : `Send to ${recipientCount} for ${estimate.creditsRequired} credits`}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-amber-300">
          Only an owner or admin can send marketing messages.
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <History className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500" />
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">History</p>
        </div>
        {broadcasts.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 py-3 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">No broadcasts yet</p>
        ) : (
          <div className="space-y-1.5">
            {broadcasts.map((b) => {
              const status = STATUS_META[b.status];
              return (
                <div key={b.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${status.cls}`}>{status.label}</span>
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-600">{timeAgo(b.createdAt)}</span>
                  </div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{b.message.replace(/<[^>]+>/g, '')}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-500">
                    <span>{b.sentCount}/{b.recipientCount || '—'} delivered</span>
                    {b.failedCount > 0 && <span className="text-red-400">{b.failedCount} failed</span>}
                    {b.creditsChargedUnits > 0 && <span>{(b.creditsChargedUnits / 100).toLocaleString()} credits</span>}
                    {b.creditsChargedUnits === 0 && b.status === 'SENT' && <span className="text-brand-400">free</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MarketingPageFallback() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="h-8 w-40 rounded bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      <div className="h-40 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
    </div>
  );
}

export default function MarketingPage() {
  return (
    <Suspense fallback={<MarketingPageFallback />}>
      <MarketingPageContent />
    </Suspense>
  );
}
