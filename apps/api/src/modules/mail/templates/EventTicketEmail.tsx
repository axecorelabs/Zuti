import React from 'react';
import { Body, Container, Head, Html, Img, Section, Text, Link, Hr } from 'react-email';

export interface EventTicketEmailProps {
  customerName: string | null;
  eventName: string;
  eventDate: string | null;
  reference: string;
  status: 'CONFIRMED' | 'AWAITING_APPROVAL';
  qrDataUrl: string;
  ticketUrl: string;
  quantity?: number;
  appName?: string;
  brandFooter?: string;
  primaryHex?: string;
}

export function EventTicketEmail({
  customerName,
  eventName,
  eventDate,
  reference,
  status,
  qrDataUrl,
  ticketUrl,
  quantity = 1,
  appName = 'Zuti',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
}: EventTicketEmailProps) {
  const isConfirmed = status === 'CONFIRMED';
  const admitsLabel = quantity > 1 ? `Admits ${quantity}` : 'Admits 1';

  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
      </Head>
      <Body style={main}>
        <Container style={container}>

          {/* Brand header */}
          <Section style={brandHeader}>
            <Text style={brandNameText}>{appName}</Text>
            <Text style={ticketLabelText}>EVENT TICKET</Text>
          </Section>

          {/* Event info */}
          <Section style={eventSection}>
            <Text style={eventNameText}>{eventName}</Text>
            {eventDate && <Text style={eventDateText}>{eventDate}</Text>}
          </Section>

          {/* Perforation divider */}
          <Hr style={perforation} />

          {/* Attendee row */}
          <Section style={attendeeSection}>
            <Text style={attendeeLabel}>ATTENDEE</Text>
            <Text style={attendeeName}>{customerName ?? 'Guest'}</Text>
          </Section>

          {/* Status + admits badge */}
          <Section style={{ textAlign: 'center' as const, marginBottom: '20px' }}>
            <Text style={statusBadge(isConfirmed)}>
              {isConfirmed ? '✓ Confirmed' : '⏳ Pending Approval'}
            </Text>
            <Text style={admitsBadge}>{admitsLabel}</Text>
          </Section>

          {/* QR code */}
          <Section style={qrSection}>
            <div style={qrWrapper}>
              <Img
                src={qrDataUrl}
                alt="Ticket QR Code"
                width="180"
                height="180"
                style={qrImage}
              />
            </div>
            <Text style={qrInstruction}>Scan at the venue to verify your registration</Text>
          </Section>

          {/* Reference */}
          <Section style={refSection}>
            <Text style={refLabel}>TICKET REF</Text>
            <Text style={refValue}>{reference.slice(-12).toUpperCase()}</Text>
          </Section>

          {/* View online link */}
          <Section style={{ textAlign: 'center' as const, marginBottom: '28px' }}>
            <Link href={ticketUrl} style={viewLink(primaryHex)}>
              View ticket online →
            </Link>
          </Section>

          {/* Footer */}
          <Hr style={footerDivider} />
          <Section style={footerSection}>
            <Text style={footerText}>{brandFooter}</Text>
            <Text style={footerNote}>
              This ticket was sent because a registration payment was completed. Keep it safe — it is your entry credential.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

export function createEventTicketEmail(props: EventTicketEmailProps) {
  return <EventTicketEmail {...props} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const main: React.CSSProperties = {
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  backgroundColor: '#09090b',
  padding: '36px 0',
};

const container: React.CSSProperties = {
  maxWidth: '480px',
  margin: '0 auto',
  backgroundColor: '#09090b',
  border: '1px solid #27272a',
  borderRadius: '16px',
  overflow: 'hidden',
};

const brandHeader: React.CSSProperties = {
  backgroundColor: '#18181b',
  padding: '20px 32px',
  borderBottom: '1px solid #27272a',
};

const brandNameText: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: '700',
  color: '#f4f4f5',
  margin: '0 0 2px 0',
  letterSpacing: '-0.3px',
};

const ticketLabelText: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: '600',
  color: '#52525b',
  letterSpacing: '0.2em',
  margin: '0',
};

const eventSection: React.CSSProperties = {
  padding: '28px 32px 20px',
  borderBottom: '1px solid #27272a',
};

const eventNameText: React.CSSProperties = {
  fontSize: '26px',
  fontWeight: '700',
  color: '#f4f4f5',
  margin: '0 0 6px 0',
  letterSpacing: '-0.5px',
  lineHeight: '1.2',
};

const eventDateText: React.CSSProperties = {
  fontSize: '14px',
  color: '#71717a',
  margin: '0',
};

const perforation: React.CSSProperties = {
  borderTop: '2px dashed #27272a',
  margin: '0',
};

const attendeeSection: React.CSSProperties = {
  padding: '20px 32px 8px',
};

const attendeeLabel: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: '600',
  color: '#52525b',
  letterSpacing: '0.15em',
  margin: '0 0 4px 0',
};

const attendeeName: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: '600',
  color: '#f4f4f5',
  margin: '0',
};

const statusBadge = (confirmed: boolean): React.CSSProperties => ({
  display: 'inline-block',
  fontSize: '12px',
  fontWeight: '600',
  color: confirmed ? '#10b981' : '#f59e0b',
  backgroundColor: confirmed ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
  border: `1px solid ${confirmed ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
  borderRadius: '20px',
  padding: '4px 14px',
  margin: '0',
});

const admitsBadge: React.CSSProperties = {
  display: 'inline-block',
  fontSize: '12px',
  fontWeight: '600',
  color: '#a1a1aa',
  backgroundColor: 'rgba(161,161,170,0.10)',
  border: '1px solid rgba(161,161,170,0.25)',
  borderRadius: '20px',
  padding: '4px 14px',
  margin: '8px 0 0 0',
};

const qrSection: React.CSSProperties = {
  textAlign: 'center',
  padding: '8px 32px 4px',
};

const qrWrapper: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  padding: '12px',
  marginBottom: '10px',
};

const qrImage: React.CSSProperties = {
  display: 'block',
};

const qrInstruction: React.CSSProperties = {
  fontSize: '12px',
  color: '#52525b',
  margin: '0',
};

const refSection: React.CSSProperties = {
  textAlign: 'center',
  padding: '16px 32px 20px',
  borderTop: '1px solid #27272a',
  marginTop: '16px',
};

const refLabel: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: '600',
  color: '#52525b',
  letterSpacing: '0.15em',
  margin: '0 0 4px 0',
};

const refValue: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: '700',
  color: '#a1a1aa',
  letterSpacing: '0.15em',
  fontFamily: 'monospace',
  margin: '0',
};

const viewLink = (primaryHex: string): React.CSSProperties => ({
  fontSize: '13px',
  color: primaryHex,
  textDecoration: 'none',
  fontWeight: '500',
});

const footerDivider: React.CSSProperties = {
  borderTop: '1px solid #27272a',
  margin: '0',
};

const footerSection: React.CSSProperties = {
  padding: '16px 32px 24px',
};

const footerText: React.CSSProperties = {
  fontSize: '12px',
  color: '#3f3f46',
  margin: '0 0 6px 0',
};

const footerNote: React.CSSProperties = {
  fontSize: '11px',
  color: '#27272a',
  margin: '0',
  lineHeight: '1.5',
};
