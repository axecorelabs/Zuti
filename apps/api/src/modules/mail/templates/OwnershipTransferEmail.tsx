import React from 'react';
import { BrandedEmailLayout } from './BrandedEmailLayout';

interface OwnershipTransferEmailProps {
  recipientName?: string;
  workspaceName: string;
  previousOwnerName: string;
  newOwnerName: string;
  dashboardUrl: string;
  appName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function OwnershipTransferEmail({
  recipientName = 'there',
  workspaceName,
  previousOwnerName,
  newOwnerName,
  dashboardUrl,
  appName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
  fromName = 'Zuti',
}: OwnershipTransferEmailProps) {
  return (
    <BrandedEmailLayout
      title="Workspace ownership changed"
      intro={
        <>
          Hi {recipientName}, ownership for <strong>{workspaceName}</strong> has been transferred from{' '}
          <strong>{previousOwnerName}</strong> to <strong>{newOwnerName}</strong>.
        </>
      }
      ctaLabel="Open workspace"
      ctaUrl={dashboardUrl}
      note="If this transfer was unexpected, review your workspace members and security settings immediately."
      brandName={appName}
      brandTagline={brandTagline}
      brandFooter={brandFooter}
      primaryHex={primaryHex}
      fromName={fromName}
    />
  );
}

export function createOwnershipTransferEmail(props: OwnershipTransferEmailProps) {
  return <OwnershipTransferEmail {...props} />;
}
