import { CalendarDays, CheckCircle2, Clock, XCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface TicketData {
  eventName: string;
  eventDate: string | null;
  customerName: string | null;
  status: 'PENDING_PAYMENT' | 'AWAITING_APPROVAL' | 'CONFIRMED' | 'CANCELLED';
  quantity?: number;
  reference: string;
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
  const eventDate = ticket.eventDate
    ? new Date(ticket.eventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

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
        </div>

        <div style={{ borderTop: '1px dashed #27272a', margin: '20px 0' }} />

        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#52525b', letterSpacing: '0.15em', margin: '0 0 4px' }}>
            ATTENDEE
          </p>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>
            {ticket.customerName ?? 'Guest'}
          </p>
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
