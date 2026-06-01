import React from 'react';
import { BrandedEmailLayout } from './BrandedEmailLayout';

interface PasswordChangedEmailProps {
  name?: string;
  securityUrl: string;
  appName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function PasswordChangedEmail({
  name = 'there',
  securityUrl,
  appName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
  fromName = 'Zuti',
}: PasswordChangedEmailProps) {
  return (
    <BrandedEmailLayout
      title="Password updated"
      intro={
        <>
          Hi {name}, your <strong>{appName}</strong> account password was successfully changed.
        </>
      }
      ctaLabel="Review account security"
      ctaUrl={securityUrl}
      note="If this was not you, reset your password immediately and contact support."
      brandName={appName}
      brandTagline={brandTagline}
      brandFooter={brandFooter}
      primaryHex={primaryHex}
      fromName={fromName}
    />
  );
}

export function createPasswordChangedEmail(props: PasswordChangedEmailProps) {
  return <PasswordChangedEmail {...props} />;
}
