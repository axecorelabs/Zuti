import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { render } from '@react-email/render';
import { createVerificationEmail } from './templates/VerificationEmail';
import { createInvitationEmail } from './templates/InvitationEmail';
import { createPasswordResetEmail } from './templates/PasswordResetEmail';
import { createPasswordChangedEmail } from './templates/PasswordChangedEmail';
import { createOwnershipTransferEmail } from './templates/OwnershipTransferEmail';
import { createInvitationStatusEmail } from './templates/InvitationStatusEmail';
import { createWorkspaceSetupRequestEmail } from './templates/WorkspaceSetupRequestEmail';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  private getBrandConfig() {
    return {
      fromAddress:
        this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'noreply@zuti.bords.app',
      fromName: this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti',
      appName: this.config.get<string>('MAIL_BRAND_NAME') ?? 'Zuti',
      appTagline: this.config.get<string>('MAIL_BRAND_TAGLINE') ?? 'AI Customer Service',
      appFooter: this.config.get<string>('MAIL_BRAND_FOOTER') ?? '© 2026 axecorelabs',
      primaryHex: this.config.get<string>('MAIL_BRAND_PRIMARY') ?? '#2563eb',
    };
  }

  private async renderEmailTemplate(component: any): Promise<string> {
    return await render(component, {
      pretty: true,
    });
  }

  async sendVerificationEmail(opts: {
    to: string;
    name?: string;
    verifyUrl: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — verification URL: ${opts.verifyUrl}`,
      );
      return;
    }

    try {
      const html = await this.renderEmailTemplate(
        createVerificationEmail({
          name: opts.name,
          verifyUrl: opts.verifyUrl,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: `Verify your ${brand.appName} account`,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Verification email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send verification email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }

  async sendInvitationEmail(opts: {
    to: string;
    orgName: string;
    inviterName: string;
    inviteUrl: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — invite URL: ${opts.inviteUrl}`,
      );
      return;
    }

    try {
      const html = await this.renderEmailTemplate(
        createInvitationEmail({
          orgName: opts.orgName,
          inviterName: opts.inviterName,
          inviteUrl: opts.inviteUrl,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: `You've been invited to join ${opts.orgName} on ${brand.appName}`,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Invitation email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send invitation email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }

  async sendPasswordResetEmail(opts: {
    to: string;
    name?: string;
    resetUrl: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — reset URL: ${opts.resetUrl}`,
      );
      return;
    }

    try {
      const html = await this.renderEmailTemplate(
        createPasswordResetEmail({
          name: opts.name,
          resetUrl: opts.resetUrl,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: `Reset your ${brand.appName} password`,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Password reset email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send password reset email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }

  async sendPasswordChangedEmail(opts: {
    to: string;
    name?: string;
    securityUrl?: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — password changed email for: ${opts.to}`,
      );
      return;
    }

    try {
      const html = await this.renderEmailTemplate(
        createPasswordChangedEmail({
          name: opts.name,
          securityUrl: opts.securityUrl ?? `${appUrl}/dashboard/settings`,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: `Your ${brand.appName} password was changed`,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Password changed email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send password changed email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }

  async sendOwnershipTransferEmail(opts: {
    to: string;
    recipientName?: string;
    workspaceName: string;
    previousOwnerName: string;
    newOwnerName: string;
    dashboardUrl?: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — ownership transfer email for: ${opts.to}`,
      );
      return;
    }

    try {
      const html = await this.renderEmailTemplate(
        createOwnershipTransferEmail({
          recipientName: opts.recipientName,
          workspaceName: opts.workspaceName,
          previousOwnerName: opts.previousOwnerName,
          newOwnerName: opts.newOwnerName,
          dashboardUrl: opts.dashboardUrl ?? `${appUrl}/dashboard/team`,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: `Ownership updated for ${opts.workspaceName}`,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Ownership transfer email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send ownership transfer email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }

  async sendInvitationStatusEmail(opts: {
    to: string;
    recipientName?: string;
    inviteeNameOrEmail: string;
    workspaceName: string;
    status: 'ACCEPTED' | 'DECLINED';
    manageUrl?: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — invitation status email for: ${opts.to}`,
      );
      return;
    }

    try {
      const html = await this.renderEmailTemplate(
        createInvitationStatusEmail({
          recipientName: opts.recipientName,
          inviteeNameOrEmail: opts.inviteeNameOrEmail,
          workspaceName: opts.workspaceName,
          status: opts.status,
          manageUrl: opts.manageUrl ?? `${appUrl}/dashboard/team`,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      const subjectPrefix = opts.status === 'ACCEPTED' ? 'Invitation accepted' : 'Invitation declined';
      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: `${subjectPrefix}: ${opts.workspaceName}`,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Invitation status email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send invitation status email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }

  async sendWorkspaceSetupRequestCreatedEmail(opts: {
    to: string;
    recipientRole: 'MANAGER' | 'REQUESTER';
    recipientName?: string;
    requesterNameOrEmail: string;
    managerNameOrEmail: string;
    requestNote?: string | null;
    dashboardUrl?: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — setup request created email for: ${opts.to}`,
      );
      return;
    }

    const dashboardUrl = opts.dashboardUrl ?? `${appUrl}/dashboard/setup-requests`;
    const isManagerRecipient = opts.recipientRole === 'MANAGER';
    const title = isManagerRecipient
      ? 'New workspace setup request'
      : 'Your setup request was sent';

    const intro = isManagerRecipient
      ? `Hi ${opts.recipientName ?? 'there'}, ${opts.requesterNameOrEmail} requested your help setting up a workspace.`
      : `Hi ${opts.recipientName ?? 'there'}, your request was sent to ${opts.managerNameOrEmail}. You can track updates in your dashboard.`;

    const note = opts.requestNote && opts.requestNote.trim().length > 0
      ? `Requester note: ${opts.requestNote.trim()}`
      : isManagerRecipient
        ? 'No additional note was included with this request.'
        : 'You can add additional context later if needed.';

    try {
      const html = await this.renderEmailTemplate(
        createWorkspaceSetupRequestEmail({
          title,
          intro,
          ctaLabel: 'Open setup requests',
          ctaUrl: dashboardUrl,
          note,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: title,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Setup request created email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send setup request created email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }

  async sendWorkspaceSetupRequestStatusEmail(opts: {
    to: string;
    recipientRole: 'MANAGER' | 'REQUESTER';
    recipientName?: string;
    requesterNameOrEmail: string;
    managerNameOrEmail: string;
    status: 'PENDING' | 'CONTACTED' | 'ORG_CREATED' | 'REQUESTER_ADDED' | 'COMPLETED' | 'DECLINED' | 'CANCELED';
    dashboardUrl?: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const brand = this.getBrandConfig();
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — setup request status email for: ${opts.to}`,
      );
      return;
    }

    const dashboardUrl = opts.dashboardUrl ?? `${appUrl}/dashboard/setup-requests`;
    const statusLabelMap: Record<string, string> = {
      PENDING: 'Pending',
      CONTACTED: 'Contacted',
      ORG_CREATED: 'Organization Created',
      REQUESTER_ADDED: 'Requester Added',
      COMPLETED: 'Completed',
      DECLINED: 'Declined',
      CANCELED: 'Canceled',
    };
    const statusLabel = statusLabelMap[opts.status] ?? opts.status;

    const intro = opts.recipientRole === 'MANAGER'
      ? `Hi ${opts.recipientName ?? 'there'}, the setup request from ${opts.requesterNameOrEmail} is now ${statusLabel}.`
      : `Hi ${opts.recipientName ?? 'there'}, your setup request with ${opts.managerNameOrEmail} is now ${statusLabel}.`;

    let note = 'Open your dashboard to continue the setup handoff.';
    if (opts.status === 'COMPLETED') note = 'This setup request is now complete.';
    if (opts.status === 'ORG_CREATED') note = 'Organization has been created and requester onboarding is in progress.';
    if (opts.status === 'REQUESTER_ADDED') note = 'Requester has been added to the newly created workspace.';
    if (opts.status === 'DECLINED') note = 'This manager declined the setup request.';
    if (opts.status === 'CANCELED') note = 'This setup request was canceled by the requester.';

    const title = `Setup request update: ${statusLabel}`;

    try {
      const html = await this.renderEmailTemplate(
        createWorkspaceSetupRequestEmail({
          title,
          intro,
          ctaLabel: 'View setup requests',
          ctaUrl: dashboardUrl,
          note,
          appName: brand.appName,
          brandTagline: brand.appTagline,
          brandFooter: brand.appFooter,
          primaryHex: brand.primaryHex,
          fromName: brand.fromName,
        }),
      );

      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: brand.fromAddress, name: brand.fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: title,
            htmlbody: html,
          },
          {
            headers: {
              Authorization: `Zoho-enczapikey ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.logger.log(`Setup request status email sent to ${opts.to}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send setup request status email to ${opts.to}: ${msg}`, err instanceof Error ? err.stack : '');
      throw err;
    }
  }
}
