import React from 'react';
import { Body, Container, Head, Html, Section, Text, Hr } from 'react-email';

export interface ReceiptLineItem {
  label: string;
  amountMinor: number;
  currency: string;
}

export interface PaymentReceiptEmailProps {
  recipientName: string | null;
  receiptNumber: string;
  description: string;
  lineItems: ReceiptLineItem[];
  totalMinor: number;
  currency: string;
  reference: string | null;
  paidAt: Date | string | null;
  companyName: string;
  companyId: string;
  appName?: string;
  brandFooter?: string;
  primaryHex?: string;
}

function formatAmount(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function formatDate(d: Date | string | null): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function PaymentReceiptEmail({
  recipientName,
  receiptNumber,
  description,
  lineItems,
  totalMinor,
  currency,
  reference,
  paidAt,
  companyName,
  companyId,
  appName = 'Zuti',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
}: PaymentReceiptEmailProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
      </Head>
      <Body style={main}>
        <Container style={container}>

          {/* Header */}
          <Section style={header}>
            <Text style={brandText}>{appName}</Text>
            <Text style={receiptLabelText}>PAYMENT RECEIPT</Text>
          </Section>

          {/* Receipt meta */}
          <Section style={metaSection}>
            <div style={metaRow}>
              <Text style={metaLabel}>Receipt no.</Text>
              <Text style={metaValue}>{receiptNumber}</Text>
            </div>
            <div style={metaRow}>
              <Text style={metaLabel}>Date paid</Text>
              <Text style={metaValue}>{formatDate(paidAt)}</Text>
            </div>
            <div style={metaRow}>
              <Text style={metaLabel}>Paid to</Text>
              <Text style={metaValue}>{companyName}</Text>
            </div>
            <div style={metaRow}>
              <Text style={metaLabel}>Company ID</Text>
              <Text style={{ ...metaValue, fontFamily: 'monospace', fontSize: '12px', color: '#71717a' }}>{companyId}</Text>
            </div>
          </Section>

          <Hr style={divider} />

          {/* Greeting */}
          <Section style={greetingSection}>
            <Text style={greetingText}>
              Hi {recipientName ?? 'there'}, here is your payment receipt for the following:
            </Text>
            <Text style={descriptionText}>{description}</Text>
          </Section>

          {/* Line items */}
          <Section style={itemsSection}>
            {/* Table header */}
            <div style={tableHeader}>
              <Text style={tableHeaderCell('left')}>Item</Text>
              <Text style={tableHeaderCell('right')}>Amount</Text>
            </div>
            <Hr style={tableHeaderDivider} />
            {lineItems.map((item, i) => (
              <div key={i} style={tableRow}>
                <Text style={tableCell('left')}>{item.label}</Text>
                <Text style={tableCell('right')}>{formatAmount(item.amountMinor, item.currency)}</Text>
              </div>
            ))}
            <Hr style={totalDivider} />
            {/* Total */}
            <div style={totalRow}>
              <Text style={totalLabel}>Total paid</Text>
              <Text style={totalValue(primaryHex)}>{formatAmount(totalMinor, currency)}</Text>
            </div>
          </Section>

          <Hr style={divider} />

          {/* Payment details */}
          <Section style={paymentSection}>
            <Text style={paymentHeader}>Payment details</Text>
            <div style={metaRow}>
              <Text style={metaLabel}>Method</Text>
              <Text style={metaValue}>Paystack</Text>
            </div>
            {reference && (
              <div style={metaRow}>
                <Text style={metaLabel}>Reference</Text>
                <Text style={{ ...metaValue, fontFamily: 'monospace', fontSize: '12px' }}>{reference}</Text>
              </div>
            )}
          </Section>

          {/* Footer */}
          <Hr style={footerDivider} />
          <Section style={footerSection}>
            <Text style={keepText}>Please keep this receipt for your records.</Text>
            <Text style={footerText}>{brandFooter}</Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

export function createPaymentReceiptEmail(props: PaymentReceiptEmailProps) {
  return <PaymentReceiptEmail {...props} />;
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

const header: React.CSSProperties = {
  backgroundColor: '#18181b',
  padding: '20px 32px',
  borderBottom: '1px solid #27272a',
};

const brandText: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: '700',
  color: '#f4f4f5',
  margin: '0 0 2px 0',
  letterSpacing: '-0.3px',
};

const receiptLabelText: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: '600',
  color: '#52525b',
  letterSpacing: '0.2em',
  margin: '0',
};

const metaSection: React.CSSProperties = {
  padding: '20px 32px 4px',
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  marginBottom: '6px',
};

const metaLabel: React.CSSProperties = {
  fontSize: '12px',
  color: '#52525b',
  margin: '0',
  minWidth: '90px',
};

const metaValue: React.CSSProperties = {
  fontSize: '13px',
  color: '#a1a1aa',
  margin: '0',
  textAlign: 'right' as const,
};

const divider: React.CSSProperties = {
  borderTop: '1px solid #27272a',
  margin: '16px 0',
};

const greetingSection: React.CSSProperties = {
  padding: '0 32px 8px',
};

const greetingText: React.CSSProperties = {
  fontSize: '14px',
  color: '#71717a',
  margin: '0 0 4px 0',
  lineHeight: '1.6',
};

const descriptionText: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: '600',
  color: '#f4f4f5',
  margin: '0',
};

const itemsSection: React.CSSProperties = {
  padding: '0 32px 8px',
};

const tableHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
};

const tableHeaderCell = (align: 'left' | 'right'): React.CSSProperties => ({
  fontSize: '10px',
  fontWeight: '600',
  color: '#52525b',
  letterSpacing: '0.12em',
  margin: '0',
  textAlign: align,
});

const tableHeaderDivider: React.CSSProperties = {
  borderTop: '1px solid #27272a',
  margin: '6px 0',
};

const tableRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  marginBottom: '4px',
};

const tableCell = (align: 'left' | 'right'): React.CSSProperties => ({
  fontSize: '14px',
  color: '#a1a1aa',
  margin: '0',
  textAlign: align,
});

const totalDivider: React.CSSProperties = {
  borderTop: '1px solid #3f3f46',
  margin: '10px 0',
};

const totalRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};

const totalLabel: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#f4f4f5',
  margin: '0',
};

const totalValue = (primaryHex: string): React.CSSProperties => ({
  fontSize: '18px',
  fontWeight: '700',
  color: primaryHex,
  margin: '0',
});

const paymentSection: React.CSSProperties = {
  padding: '0 32px 16px',
};

const paymentHeader: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: '600',
  color: '#52525b',
  letterSpacing: '0.12em',
  margin: '0 0 10px 0',
};

const footerDivider: React.CSSProperties = {
  borderTop: '1px solid #27272a',
  margin: '0',
};

const footerSection: React.CSSProperties = {
  padding: '16px 32px 24px',
};

const keepText: React.CSSProperties = {
  fontSize: '12px',
  color: '#52525b',
  margin: '0 0 8px 0',
};

const footerText: React.CSSProperties = {
  fontSize: '11px',
  color: '#3f3f46',
  margin: '0',
};
