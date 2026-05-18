import React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Section,
  Text,
} from 'react-email';

interface BrandedEmailLayoutProps {
  title: string;
  intro: React.ReactNode;
  ctaLabel: string;
  ctaUrl: string;
  note?: string;
  brandName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function BrandedEmailLayout({
  title,
  intro,
  ctaLabel,
  ctaUrl,
  note,
  brandName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
}: BrandedEmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
      </Head>
      <Body style={main}>
        <Container style={container}>
          <Section style={headerSection}>
            <Text style={brandNameText}>{brandName}</Text>
            <Text style={brandTaglineText}>{brandTagline}</Text>
          </Section>

          {/* Content */}
          <Section style={contentSection}>
            <Text style={titleText}>{title}</Text>
            <Text style={introText}>{intro}</Text>

            <Link href={ctaUrl} style={ctaButton(primaryHex)}>
              {ctaLabel}
            </Link>

            {note && <Text style={noteText}>{note}</Text>}
          </Section>

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>{brandFooter}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
  maxWidth: '520px',
  margin: '0 auto',
  padding: '36px 24px',
  backgroundColor: '#09090b',
  color: '#f4f4f5',
  borderRadius: '14px',
};

const container = {
  margin: '0 auto',
  padding: '0',
};

const headerSection = {
  marginBottom: '28px',
};

const brandNameText = {
  fontSize: '20px',
  fontWeight: '700' as const,
  letterSpacing: '-0.3px',
  color: '#f4f4f5',
  margin: '0 0 4px 0',
};

const brandTaglineText = {
  fontSize: '12px',
  color: '#71717a',
  margin: '0',
};

const contentSection = {
  marginBottom: '28px',
};

const titleText = {
  fontSize: '22px',
  fontWeight: '700' as const,
  margin: '0 0 8px 0',
  color: '#f4f4f5',
};

const introText = {
  color: '#a1a1aa',
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0 0 28px 0',
};

const ctaButton = (primaryHex: string) => ({
  display: 'inline-block' as const,
  background: primaryHex,
  color: '#fff',
  textDecoration: 'none',
  padding: '12px 28px',
  borderRadius: '8px',
  fontSize: '15px',
  fontWeight: '500' as const,
});

const noteText = {
  marginTop: '28px',
  color: '#52525b',
  fontSize: '13px',
  lineHeight: '1.6',
  borderTop: '1px solid #27272a',
  paddingTop: '16px',
};

const footerSection = {
  marginTop: '28px',
  borderTop: '1px solid #27272a',
  paddingTop: '16px',
};

const footerText = {
  color: '#3f3f46',
  fontSize: '12px',
  margin: '0',
};
