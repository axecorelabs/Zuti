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

  async sendInvitationEmail(opts: {
    to: string;
    orgName: string;
    inviterName: string;
    inviteUrl: string;
  }) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const fromAddress =
      this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'noreply@zuti.bords.app';
    const fromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';

    if (!apiKey) {
      this.logger.warn(
        `[MailService] ZEPTOMAIL_API_KEY not set — invite URL: ${opts.inviteUrl}`,
      );
      return;
    }

    const html = `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#09090b;color:#f4f4f5;border-radius:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
          <div style="width:32px;height:32px;border-radius:8px;background:#2563eb;display:flex;align-items:center;justify-content:center;">
            <span style="font-size:16px;">🌿</span>
          </div>
          <span style="font-size:20px;font-weight:700;letter-spacing:-0.3px;">Zuti</span>
        </div>
        <h1 style="font-size:22px;font-weight:700;margin:0 0 8px;">You're invited 🎉</h1>
        <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 28px;">
          <strong style="color:#f4f4f5;">${opts.inviterName}</strong> has invited you to join
          <strong style="color:#f4f4f5;">${opts.orgName}</strong> on Zuti.
        </p>
        <a href="${opts.inviteUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:500;">
          Accept Invitation
        </a>
        <p style="margin-top:28px;color:#52525b;font-size:13px;line-height:1.5;">
          This invitation expires in 7 days.<br>
          If you weren't expecting this, you can safely ignore this email.
        </p>
        <hr style="border:none;border-top:1px solid #27272a;margin:28px 0 16px;" />
        <p style="color:#3f3f46;font-size:12px;margin:0;">© 2026 axecorelabs</p>
      </div>
    `;

    try {
      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: fromAddress, name: fromName },
            to: [{ email_address: { address: opts.to } }],
            subject: `You've been invited to join ${opts.orgName} on Zuti`,
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
