import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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

  private wrapBrandedHtml(opts: {
    title: string;
    intro: string;
    ctaLabel: string;
    ctaUrl: string;
    note: string;
  }) {
    const brand = this.getBrandConfig();

    return `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:36px 24px;background:#09090b;color:#f4f4f5;border-radius:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
          <div style="width:34px;height:34px;border-radius:10px;background:${brand.primaryHex};display:flex;align-items:center;justify-content:center;">
            <span style="font-size:16px;color:#fff;line-height:1;">Z</span>
          </div>
          <div>
            <div style="font-size:20px;font-weight:700;letter-spacing:-0.3px;">${brand.appName}</div>
            <div style="font-size:12px;color:#71717a;">${brand.appTagline}</div>
          </div>
        </div>

        <h1 style="font-size:22px;font-weight:700;margin:0 0 8px;">${opts.title}</h1>
        <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 28px;">${opts.intro}</p>

        <a href="${opts.ctaUrl}"
          style="display:inline-block;background:${brand.primaryHex};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:500;">
          ${opts.ctaLabel}
        </a>

        <p style="margin-top:28px;color:#52525b;font-size:13px;line-height:1.6;">${opts.note}</p>
        <hr style="border:none;border-top:1px solid #27272a;margin:28px 0 16px;" />
        <p style="color:#3f3f46;font-size:12px;margin:0;">${brand.appFooter}</p>
      </div>
    `;
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

    const html = this.wrapBrandedHtml({
      title: 'Verify your email',
      intro: `Hi ${opts.name ?? 'there'}, confirm your email address to activate your account and start using ${brand.appName}.`,
      ctaLabel: 'Verify email',
      ctaUrl: opts.verifyUrl,
      note: "This verification link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    });

    try {
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
      this.logger.error(`Failed to send verification email to ${opts.to}: ${msg}`);
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

    const html = this.wrapBrandedHtml({
      title: "You're invited",
      intro: `<strong style=\"color:#f4f4f5;\">${opts.inviterName}</strong> has invited you to join <strong style=\"color:#f4f4f5;\">${opts.orgName}</strong> on ${brand.appName}.`,
      ctaLabel: 'Accept invitation',
      ctaUrl: opts.inviteUrl,
      note: "This invitation expires in 7 days. If you weren't expecting this, you can safely ignore this email.",
    });

    try {
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
      this.logger.error(`Failed to send invitation email to ${opts.to}: ${msg}`);
    }
  }
}
