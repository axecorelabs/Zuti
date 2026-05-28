import React from 'react';
import { BrandedEmailLayout } from './BrandedEmailLayout';

interface PasswordResetEmailProps {
  name?: string;
  resetUrl: string;
  appName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function PasswordResetEmail({
  name = 'there',
  resetUrl,
  appName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
  fromName = 'Zuti',
}: PasswordResetEmailProps) {
  return (
    <BrandedEmailLayout
      title="Reset your password"
      intro={
        <>
          Hi {name}, we received a request to reset your <strong>{appName}</strong> password.
        </>
      }
      ctaLabel="Reset password"
      ctaUrl={resetUrl}
      note="This reset link expires in 1 hour. If you did not request this, you can safely ignore this email."
      brandName={appName}
      brandTagline={brandTagline}
      brandFooter={brandFooter}
      primaryHex={primaryHex}
      fromName={fromName}
    />
  );
}

export function createPasswordResetEmail(props: PasswordResetEmailProps) {
  return <PasswordResetEmail {...props} />;
}
