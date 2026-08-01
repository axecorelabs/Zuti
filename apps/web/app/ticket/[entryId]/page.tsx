import { CalendarDays, CheckCircle2, Clock, XCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface TicketData {
  eventName: string;
  eventDate: string | null;
  eventEndDate?: string | null;
  eventDateHasTime?: boolean;
  venue?: string | null;
  customerName: string | null;
  ticketType?: string | null;
  status: 'PENDING_PAYMENT' | 'AWAITING_APPROVAL' | 'CONFIRMED' | 'CANCELLED';
  quantity?: number;
  reference: string;
  checkedInAt?: string | null;
  qrDataUrl?: string | null;
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

const STATUS_CONFIG: Record<TicketData['status'], { label: string; icon: typeof CheckCircle2; color: string; bg: string; border: string }> = {
  CONFIRMED: { label: 'Confirmed', icon: CheckCircle2, color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', icon: Clock, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  PENDING_PAYMENT: { label: 'Pending Payment', icon: Clock, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  CANCELLED: { label: 'Cancelled', icon: XCircle, color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
};

export default async function TicketPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const ticket = await getTicket(entryId);

  if (!ticket) {
    return (
      <div style={pageWrap}>
        <div style={cardStyle}>
          <XCircle style={{ width: 40, height: 40, color: '#71717a', margin: '0 auto 16px' }} />
          <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: 0, textAlign: 'center' }}>
            Ticket not found
          </p>
          <p style={{ fontSize: 13, color: '#71717a', margin: '8px 0 0', textAlign: 'center' }}>
            This ticket link may be invalid or the registration was removed.
          </p>
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[ticket.status];
  const StatusIcon = status.icon;
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
    <div style={pageWrap}>
      <div style={cardStyle}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#52525b', letterSpacing: '0.15em', margin: '0 0 4px' }}>
            EVENT TICKET
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f4f4f5', margin: 0, letterSpacing: '-0.4px' }}>
            {ticket.eventName}
          </h1>
          {eventDate && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#71717a', margin: '8px 0 0' }}>
              <CalendarDays style={{ width: 14, height: 14 }} /> {eventDate}
            </p>
          )}
          {ticket.venue && (
            <p style={{ fontSize: 13, color: '#71717a', margin: '4px 0 0' }}>{ticket.venue}</p>
          )}
        </div>

        <div style={{ borderTop: '1px dashed #27272a', margin: '20px 0' }} />

        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#52525b', letterSpacing: '0.15em', margin: '0 0 4px' }}>
            ATTENDEE
          </p>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>
            {ticket.customerName ?? 'Guest'}
          </p>
          {ticket.ticketType && (
            <p style={{ fontSize: 12, color: '#818cf8', margin: '4px 0 0', fontWeight: 600 }}>{ticket.ticketType}</p>
          )}
        </div>

        <div style={{ textAlign: 'center', margin: '20px 0', display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: status.color,
              backgroundColor: status.bg,
              border: `1px solid ${status.border}`,
              borderRadius: 20,
              padding: '6px 16px',
            }}
          >
            <StatusIcon style={{ width: 14, height: 14 }} /> {status.label}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: '#a1a1aa',
              backgroundColor: 'rgba(161,161,170,0.10)',
              border: '1px solid rgba(161,161,170,0.25)',
              borderRadius: 20,
              padding: '6px 16px',
            }}
          >
            Admits {ticket.quantity ?? 1}
          </span>
        </div>

        {ticket.status === 'CONFIRMED' && (ticket.qrDataUrl || ticket.checkedInAt) && (
          <div style={{ borderTop: '1px dashed #27272a', margin: '20px 0', paddingTop: 20, textAlign: 'center' }}>
            {ticket.checkedInAt ? (
              <div style={{ padding: '20px', borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <CheckCircle2 style={{ width: 32, height: 32, color: '#10b981', margin: '0 auto 8px' }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: '#10b981', margin: 0 }}>Admitted</p>
                <p style={{ fontSize: 12, color: '#71717a', margin: '4px 0 0' }}>
                  {new Date(ticket.checkedInAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ) : ticket.qrDataUrl ? (
              <>
                <p style={{ fontSize: 10, fontWeight: 600, color: '#52525b', letterSpacing: '0.15em', margin: '0 0 10px' }}>SCAN AT ENTRANCE</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ticket.qrDataUrl} alt="Admission QR code" style={{ display: 'block', margin: '0 auto', width: 200, height: 200, borderRadius: 12, background: '#fff', padding: 10 }} />
                <p style={{ fontSize: 11, color: '#71717a', margin: '10px 0 0' }}>Present this code at the door for admission.</p>
              </>
            ) : null}
          </div>
        )}

        <div style={{ borderTop: '1px solid #27272a', marginTop: 20, paddingTop: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#52525b', letterSpacing: '0.15em', margin: '0 0 4px' }}>
            TICKET REF
          </p>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#a1a1aa', letterSpacing: '0.15em', fontFamily: 'monospace', margin: 0 }}>
            {ticket.reference}
          </p>
        </div>
      </div>
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  backgroundColor: '#09090b',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 420,
  backgroundColor: '#0d0d0f',
  border: '1px solid #27272a',
  borderRadius: 20,
  padding: '32px 28px',
};
