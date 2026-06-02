import React from 'react';
import { BrandedEmailLayout } from './BrandedEmailLayout';

interface WorkspaceSetupRequestEmailProps {
  recipientName?: string;
  title: string;
  intro: React.ReactNode;
  ctaLabel: string;
  ctaUrl: string;
  note?: string;
  appName?: string;
  brandTagline?: string;
  brandFooter?: string;
  primaryHex?: string;
  fromName?: string;
}

export function WorkspaceSetupRequestEmail({
  title,
  intro,
  ctaLabel,
  ctaUrl,
  note,
  appName = 'Zuti',
  brandTagline = 'AI Customer Service',
  brandFooter = '© 2026 axecorelabs',
  primaryHex = '#2563eb',
  fromName = 'Zuti',
}: WorkspaceSetupRequestEmailProps) {
  return (
    <BrandedEmailLayout
      title={title}
      intro={intro}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
      note={note}
      brandName={appName}
      brandTagline={brandTagline}
      brandFooter={brandFooter}
      primaryHex={primaryHex}
      fromName={fromName}
    />
  );
}

export function createWorkspaceSetupRequestEmail(props: WorkspaceSetupRequestEmailProps) {
  return <WorkspaceSetupRequestEmail {...props} />;
}
