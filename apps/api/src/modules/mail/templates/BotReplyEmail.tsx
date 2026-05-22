import React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Section,
  Text,
} from 'react-email';

interface BotReplyEmailProps {
  botName: string;
  orgName: string;
  replyText: string;
  /** Brand accent colour — defaults to blue */
  primaryHex?: string;
}

/** Convert a markdown-ish plain text reply into structured React nodes.
 *  Handles: bold (**text**), bullet lists (- item or * item), numbered lists, paragraphs.
 *  Everything else is rendered as plain text paragraphs. */
function renderBody(text: string, primaryHex: string): React.ReactNode {
  const paragraphs = text.split(/\n{2,}/);

  return paragraphs.map((block, i) => {
    const lines = block.split('\n').filter(Boolean);

    // Bullet list block
    if (lines.every(l => /^[-*]\s/.test(l.trim()))) {
      return (
        <Section key={i} style={listSection}>
          {lines.map((l, j) => (
            <Text key={j} style={listItem}>
              <span style={{ color: primaryHex, marginRight: '8px' }}>•</span>
              {renderInline(l.replace(/^[-*]\s/, '').trim())}
            </Text>
          ))}
        </Section>
      );
    }

    // Numbered list block
    if (lines.every(l => /^\d+[.)]\s/.test(l.trim()))) {
      return (
        <Section key={i} style={listSection}>
          {lines.map((l, j) => (
            <Text key={j} style={listItem}>
              <span style={{ color: primaryHex, fontWeight: 600, marginRight: '8px' }}>
                {j + 1}.
              </span>
              {renderInline(l.replace(/^\d+[.)]\s/, '').trim())}
            </Text>
          ))}
        </Section>
      );
    }

    // Regular paragraph (may contain inline bold)
    return (
      <Text key={i} style={bodyText}>
        {renderInline(block.trim())}
      </Text>
    );
  });
}

/** Handle inline **bold** and *italic* markers */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export function BotReplyEmail({
  botName,
  orgName,
  replyText,
  primaryHex = '#2563eb',
}: BotReplyEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={brandText}>{orgName}</Text>
            <Text style={subText}>Powered by Zuti</Text>
          </Section>

          <Hr style={divider} />

          {/* Body */}
          <Section style={contentSection}>
            {renderBody(replyText, primaryHex)}
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              This message was sent by {botName} on behalf of {orgName}.
              Reply to this email to continue the conversation.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main: React.CSSProperties = {
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  backgroundColor: '#f4f4f5',
  padding: '32px 16px',
};

const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  overflow: 'hidden',
  border: '1px solid #e4e4e7',
};

const header: React.CSSProperties = {
  padding: '24px 32px 16px',
};

const brandText: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#18181b',
  margin: '0 0 2px 0',
  letterSpacing: '-0.3px',
};

const subText: React.CSSProperties = {
  fontSize: '12px',
  color: '#a1a1aa',
  margin: '0',
};

const divider: React.CSSProperties = {
  borderColor: '#f4f4f5',
  margin: '0',
};

const contentSection: React.CSSProperties = {
  padding: '24px 32px',
};

const bodyText: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.65',
  color: '#3f3f46',
  margin: '0 0 16px 0',
};

const listSection: React.CSSProperties = {
  margin: '0 0 16px 0',
};

const listItem: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.65',
  color: '#3f3f46',
  margin: '0 0 8px 0',
  paddingLeft: '8px',
};

const footer: React.CSSProperties = {
  padding: '16px 32px 24px',
  backgroundColor: '#fafafa',
};

const footerText: React.CSSProperties = {
  fontSize: '12px',
  color: '#a1a1aa',
  margin: '0',
  lineHeight: '1.5',
};
