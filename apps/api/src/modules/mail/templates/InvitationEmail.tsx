import React from 'react';
import { BrandedEmailLayout } from './BrandedEmailLayout';

interface InvitationEmailProps {
  orgName: string;
  inviterName: string;
  inviteUrl: string;
  appName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function InvitationEmail({
  orgName,
  inviterName,
  inviteUrl,
  appName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
  fromName = 'Zuti',
}: InvitationEmailProps) {
  return (
    <BrandedEmailLayout
      title="You're invited"
      intro={
        <>
          <strong style={{ color: '#f4f4f5' }}>{inviterName}</strong> has invited you to join{' '}
          <strong style={{ color: '#f4f4f5' }}>{orgName}</strong> on {appName}.
        </>
      }
      ctaLabel="Accept invitation"
      ctaUrl={inviteUrl}
      note="This invitation expires in 7 days. If you weren't expecting this, you can safely ignore this email."
      brandName={appName}
      brandTagline={brandTagline}
      brandFooter={brandFooter}
      primaryHex={primaryHex}
      fromName={fromName}
    />
  );
}

export function createInvitationEmail(props: InvitationEmailProps) {
  return <InvitationEmail {...props} />;
}
