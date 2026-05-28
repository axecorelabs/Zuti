import React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Section,
  Text,
} from 'react-email';

interface ActionForwardingEmailProps {
  botName: string;
  actionType: string;
  priority: string;
  summary: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  companyName?: string | null;
  consultationPurpose?: string | null;
  bookingReason?: string | null;
  issueSummary?: string | null;
  issueDetails?: string | null;
  preferredDatetime?: string | null;
  messageText?: string | null;
  actionTaskId: string;
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <Text style={rowText}>
      <strong>{label}:</strong> {value}
    </Text>
  );
}

export function ActionForwardingEmail({
  botName,
  actionType,
  priority,
  summary,
  customerName,
  customerEmail,
  customerPhone,
  companyName,
  consultationPurpose,
  bookingReason,
  issueSummary,
  issueDetails,
  preferredDatetime,
  messageText,
  actionTaskId,
}: ActionForwardingEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={title}>New Customer Request</Text>
            <Text style={subtitle}>Created by {botName}</Text>
          </Section>

          <Section style={card}>
            <Row label="Topic" value={actionType} />
            <Row label="Urgency" value={priority} />
            <Row label="Request summary" value={summary} />
            <Row label="Customer name" value={customerName} />
            <Row label="Customer email" value={customerEmail} />
            <Row label="Customer phone" value={customerPhone} />
            <Row label="Company" value={companyName} />
            <Row label="Consultation purpose" value={consultationPurpose} />
            <Row label="Reason for booking" value={bookingReason} />
            <Row label="Issue summary" value={issueSummary} />
            <Row label="Issue details" value={issueDetails} />
            <Row label="Preferred time" value={preferredDatetime} />
            <Row label="Reference ID" value={actionTaskId} />
          </Section>

          {messageText ? (
            <Section style={messageCard}>
              <Text style={messageTitle}>Customer Message</Text>
              <Text style={messageTextStyle}>{messageText}</Text>
            </Section>
          ) : null}

          <Text style={footer}>This is an automated notification from Zuti.</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main: React.CSSProperties = {
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  backgroundColor: '#f5f7fb',
  padding: '24px 12px',
};

const container: React.CSSProperties = {
  maxWidth: '620px',
  margin: '0 auto',
};

const header: React.CSSProperties = {
  marginBottom: '14px',
};

const title: React.CSSProperties = {
  margin: '0',
  color: '#0f172a',
  fontSize: '22px',
  fontWeight: 700,
};

const subtitle: React.CSSProperties = {
  margin: '6px 0 0 0',
  color: '#64748b',
  fontSize: '13px',
};

const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '16px 18px',
};

const messageCard: React.CSSProperties = {
  marginTop: '12px',
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '16px 18px',
};

const rowText: React.CSSProperties = {
  margin: '0 0 10px 0',
  color: '#1e293b',
  fontSize: '14px',
  lineHeight: '1.55',
};

const messageTitle: React.CSSProperties = {
  margin: '0 0 8px 0',
  color: '#0f172a',
  fontSize: '14px',
  fontWeight: 700,
};

const messageTextStyle: React.CSSProperties = {
  margin: '0',
  color: '#334155',
  fontSize: '14px',
  lineHeight: '1.6',
  whiteSpace: 'pre-wrap',
};

const footer: React.CSSProperties = {
  marginTop: '14px',
  color: '#94a3b8',
  fontSize: '12px',
};
