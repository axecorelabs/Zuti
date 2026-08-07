import { CalendarDays, CheckCircle2, Clock, XCircle, Video, Send, MapPin } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import EmailOptInButton from './email-optin-button';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface TicketData {
  eventName: string;
  eventDate: string | null;
  eventEndDate?: string | null;
  eventDateHasTime?: boolean;
  venue?: string | null;
  locationType?: string;
  onlineMeetingUrl?: string | null;
  onlineMeetingPlatform?: string | null;
  joinLinkLocked?: boolean;
  joinLinkUnlocksAt?: string | null;
  customerName: string | null;
  ticketType?: string | null;
  status: 'PENDING_PAYMENT' | 'AWAITING_APPROVAL' | 'CONFIRMED' | 'CANCELLED';
  quantity?: number;
  reference: string;
  checkedInAt?: string | null;
  qrDataUrl?: string | null;
  communityInvites?: Array<{ name: string; deepLink: string }>;
  emailOptInAvailable?: boolean;
}

async function getTicket(entryId: string): Promise<TicketData | null> {
  try {
    const res = await fetch(`${API_URL}/api/public/tickets/${entryId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const STATUS_CONFIG: Record<TicketData['status'], { label: string; icon: typeof CheckCircle2; className: string }> = {
  CONFIRMED: { label: 'Confirmed', icon: CheckCircle2, className: 'text-emerald-400 bg-emerald-500/[0.12] border-emerald-500/30' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', icon: Clock, className: 'text-amber-400 bg-amber-500/[0.12] border-amber-500/30' },
  PENDING_PAYMENT: { label: 'Pending Payment', icon: Clock, className: 'text-amber-400 bg-amber-500/[0.12] border-amber-500/30' },
  CANCELLED: { label: 'Cancelled', icon: XCircle, className: 'text-red-400 bg-red-500/[0.12] border-red-500/30' },
};

export default async function TicketPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const ticket = await getTicket(entryId);

  if (!ticket) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="rounded-[18px] border border-zinc-800 bg-zinc-900 text-center max-w-[380px] p-8">
            <XCircle className="w-9 h-9 text-zinc-700 mx-auto mb-3" />
            <p className="text-base font-semibold text-zinc-100">Ticket not found</p>
            <p className="text-[13px] text-zinc-500 mt-2">This ticket link may be invalid or the registration was removed.</p>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const status = STATUS_CONFIG[ticket.status];
  const StatusIcon = status.icon;
  const isOnline = ticket.locationType === 'ONLINE' || ticket.locationType === 'HYBRID';
  const eventDate = (() => {
    if (!ticket.eventDate) return null;
    const start = new Date(ticket.eventDate);
    const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const startStr = start.toLocaleDateString('en-GB', dateOpts);
    const end = ticket.eventEndDate ? new Date(ticket.eventEndDate) : null;
    if (!end || end.toDateString() === start.toDateString()) return startStr;
    return `${startStr} – ${end.toLocaleDateString('en-GB', dateOpts)}`;
  })();

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-[440px] rounded-[20px] border border-zinc-800 bg-zinc-900 p-7 sm:p-8">
          <p className="text-[10.5px] font-semibold text-zinc-600 tracking-[0.15em] mb-1">EVENT TICKET</p>
          <h1 className="font-brand text-2xl font-bold text-white tracking-tight leading-snug">{ticket.eventName}</h1>
          {eventDate && (
            <p className="flex items-center gap-1.5 text-[13px] text-zinc-500 mt-2">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" /> {eventDate}
            </p>
          )}
          {ticket.venue && (
            <p className="flex items-center gap-1.5 text-[13px] text-zinc-500 mt-1">
              <MapPin className="w-3.5 h-3.5 shrink-0" /> {ticket.venue}
            </p>
          )}

          <div className="border-t border-dashed border-zinc-800 my-5" />

          <p className="text-[10px] font-semibold text-zinc-600 tracking-[0.15em] mb-1">ATTENDEE</p>
          <p className="text-base font-semibold text-white">{ticket.customerName ?? 'Guest'}</p>
          {ticket.ticketType && <p className="text-xs font-semibold text-brand-400 mt-1">{ticket.ticketType}</p>}

          <div className="flex items-center justify-center gap-2 flex-wrap my-5">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-full border ${status.className}`}>
              <StatusIcon className="w-3.5 h-3.5" /> {status.label}
            </span>
            <span className="inline-flex items-center text-xs font-semibold px-4 py-1.5 rounded-full border border-zinc-700 text-zinc-400 bg-zinc-800/60">
              Admits {ticket.quantity ?? 1}
            </span>
          </div>

          {ticket.status === 'CONFIRMED' && isOnline && (
            <div className="border-t border-dashed border-zinc-800 pt-5 mt-5 text-center">
              <p className="flex items-center justify-center gap-1.5 text-[10px] font-semibold text-zinc-600 tracking-[0.15em] mb-2.5">
                <Video className="w-3 h-3" /> {(ticket.onlineMeetingPlatform || 'ONLINE EVENT').toUpperCase()}
              </p>
              {ticket.onlineMeetingUrl ? (
                <a href={ticket.onlineMeetingUrl} target="_blank" rel="noopener noreferrer" className="block px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition-colors">
                  Join meeting
                </a>
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3.5">
                  <p className="text-[13px] text-zinc-400">
                    {ticket.joinLinkUnlocksAt
                      ? `Join link unlocks ${new Date(ticket.joinLinkUnlocksAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                      : 'Join link unlocks shortly before the event starts'}
                  </p>
                </div>
              )}
            </div>
          )}

          {ticket.status === 'CONFIRMED' && (ticket.qrDataUrl || ticket.checkedInAt) && (
            <div className="border-t border-dashed border-zinc-800 pt-5 mt-5 text-center">
              {ticket.checkedInAt ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] p-5">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-emerald-400">Admitted</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {new Date(ticket.checkedInAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ) : ticket.qrDataUrl ? (
                <>
                  <p className="text-[10px] font-semibold text-zinc-600 tracking-[0.15em] mb-2.5">SCAN AT ENTRANCE</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ticket.qrDataUrl} alt="Admission QR code" className="block mx-auto w-[200px] h-[200px] rounded-xl bg-white p-2.5" />
                  <p className="text-[11px] text-zinc-500 mt-2.5">Present this code at the door for admission.</p>
                </>
              ) : null}
            </div>
          )}

          {ticket.status === 'CONFIRMED' && ticket.communityInvites && ticket.communityInvites.length > 0 && (
            <div className="border-t border-dashed border-zinc-800 pt-5 mt-5">
              <p className="text-center text-[10px] font-semibold text-zinc-600 tracking-[0.15em] mb-2.5">STAY IN THE LOOP</p>
              <div className="flex flex-col gap-2">
                {ticket.communityInvites.map((invite) => (
                  <a
                    key={invite.deepLink}
                    href={invite.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-brand-600/30 bg-brand-600/[0.10] text-brand-400 font-semibold text-[13px] hover:bg-brand-600/[0.16] transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" /> Join {invite.name} on Telegram
                  </a>
                ))}
              </div>
            </div>
          )}

          {ticket.status === 'CONFIRMED' && ticket.emailOptInAvailable && (
            <div className="border-t border-dashed border-zinc-800 pt-5 mt-5">
              <EmailOptInButton entryId={entryId} />
            </div>
          )}

          <div className="border-t border-zinc-800 mt-5 pt-4 text-center">
            <p className="text-[10px] font-semibold text-zinc-600 tracking-[0.15em] mb-1">TICKET REF</p>
            <p className="text-lg font-bold text-zinc-400 tracking-[0.15em] font-mono">{ticket.reference}</p>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
