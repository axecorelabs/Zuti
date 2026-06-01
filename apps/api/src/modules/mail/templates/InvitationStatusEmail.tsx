import React from 'react';
import { BrandedEmailLayout } from './BrandedEmailLayout';

interface InvitationStatusEmailProps {
  recipientName?: string;
  inviteeNameOrEmail: string;
  workspaceName: string;
  status: 'ACCEPTED' | 'DECLINED';
  manageUrl: string;
  appName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function InvitationStatusEmail({
  recipientName = 'there',
  inviteeNameOrEmail,
  workspaceName,
  status,
  manageUrl,
  appName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
  fromName = 'Zuti',
}: InvitationStatusEmailProps) {
  const isAccepted = status === 'ACCEPTED';

  return (
    <BrandedEmailLayout
      title={isAccepted ? 'Invitation accepted' : 'Invitation declined'}
      intro={
        <>
          Hi {recipientName}, <strong>{inviteeNameOrEmail}</strong> has {isAccepted ? 'accepted' : 'declined'} the invitation to{' '}
          <strong>{workspaceName}</strong>.
        </>
      }
      ctaLabel="Manage workspace"
      ctaUrl={manageUrl}
      note={isAccepted
        ? 'You can review role permissions from your Team page.'
        : 'You can invite another member from your Team page at any time.'}
      brandName={appName}
      brandTagline={brandTagline}
      brandFooter={brandFooter}
      primaryHex={primaryHex}
      fromName={fromName}
    />
  );
}

export function createInvitationStatusEmail(props: InvitationStatusEmailProps) {
  return <InvitationStatusEmail {...props} />;
}
