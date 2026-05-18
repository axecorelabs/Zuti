import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { render } from '@react-email/render';
import { createVerificationEmail } from './templates/VerificationEmail';
import { createInvitationEmail } from './templates/InvitationEmail';

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
}
