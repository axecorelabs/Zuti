import React from 'react';
import { BrandedEmailLayout } from './BrandedEmailLayout';

interface VerificationEmailProps {
  name?: string;
  verifyUrl: string;
  appName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function VerificationEmail({
  name = 'there',
  verifyUrl,
  appName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
  fromName = 'Zuti',
}: VerificationEmailProps) {
  return (
    <BrandedEmailLayout
      title="Verify your email"
      intro={
        <>
          Hi {name}, confirm your email address to activate your account and start using{' '}
          <strong>{appName}</strong>.
        </>
      }
      ctaLabel="Verify email"
      ctaUrl={verifyUrl}
      note="This verification link expires in 24 hours. If you didn't create an account, you can ignore this email."
      brandName={appName}
      brandTagline={brandTagline}
      brandFooter={brandFooter}
      primaryHex={primaryHex}
      fromName={fromName}
    />
  );
}

export function createVerificationEmail(props: VerificationEmailProps) {
  return <VerificationEmail {...props} />;
}
