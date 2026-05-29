import {
  Controller, Post, Param, Body, Headers, Get, Query,
  Logger, HttpCode, HttpStatus, UseInterceptors, Req, ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { TELEGRAM_QUEUE, EMAIL_QUEUE, WHATSAPP_QUEUE } from '../queue/queue.module';
import { TelegramMessageJob } from '../queue/telegram.processor';
import { EmailMessageJob } from '../queue/email.processor';
import { WhatsAppMessageJob } from '../queue/whatsapp.processor';
import { BillingService } from '../billing/billing.service';
import { extractWhatsAppConfig, verifyMetaWebhookSignature, verifyTwilioWebhookSignature } from '../../common/utils/whatsapp';

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  private getTwilioSignatureUrl(req: any): string {
    const forwardedProtoRaw = typeof req?.headers?.['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto']
      : undefined;
    const forwardedHostRaw = typeof req?.headers?.['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host']
      : undefined;
    const proto = (forwardedProtoRaw ?? req?.protocol ?? 'https').split(',')[0].trim();
    const host = (forwardedHostRaw ?? req?.get?.('host') ?? '').split(',')[0].trim();
    const path = typeof req?.originalUrl === 'string' ? req.originalUrl : '';
    return `${proto}://${host}${path}`;
  }

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TELEGRAM_QUEUE) private readonly telegramQueue: Queue,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(WHATSAPP_QUEUE) private readonly whatsappQueue: Queue,
    private readonly billing: BillingService,
  ) {}

  // ── Telegram ──────────────────────────────────────────────────────────────

  @Post('telegram/:botId')
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async handleTelegramUpdate(
    @Param('botId') botId: string,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Body() update: any,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, isActive: true, telegramToken: { not: null } },
    });

    if (!bot) {
      this.logger.warn(`Received webhook for unknown/inactive bot: ${botId}`);
      return { ok: true };
    }

    if (bot.webhookSecret) {
      if (!secretHeader || secretHeader !== bot.webhookSecret) {
        this.logger.warn(`Webhook secret mismatch for bot ${botId} — request rejected`);
        return { ok: true };
      }
    }

    const message = update?.message;
    if (!message?.text) return { ok: true };

    const job: TelegramMessageJob = {
      botId: bot.id,
      telegramChatId: String(message.chat.id),
      telegramToken: bot.telegramToken as string,
      organizationId: bot.organizationId,
      message: {
        messageId: message.message_id,
        text: message.text,
        from: {
          id: message.from.id,
          username: message.from.username,
          firstName: message.from.first_name,
          lastName: message.from.last_name,
        },
      },
    };

    await this.telegramQueue.add(job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return { ok: true };
  }

  // ── Email (SendGrid Inbound Parse) ────────────────────────────────────────
  // SendGrid POSTs multipart/form-data to this single endpoint.
  // The bot is identified by the `to` address (Zuti-hosted OR custom domain).

  @Post('email')
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @UseInterceptors(AnyFilesInterceptor())
  @HttpCode(HttpStatus.OK)
  async handleEmailInbound(@Body() body: Record<string, string>) {
    let toAddress: string = body.to ?? '';
    let fromEmail: string = body.from ?? '';

    // `from` may be "Name <email@example.com>" — extract just the email
    const emailMatch = fromEmail.match(/<([^>]+)>/);
    if (emailMatch) fromEmail = emailMatch[1];
    const fromName = body.from?.replace(/<[^>]+>/, '').trim().replace(/"/g, '') ?? '';

    // `to` may also contain display name
    const toMatch = toAddress.match(/<([^>]+)>/);
    if (toMatch) toAddress = toMatch[1];
    toAddress = toAddress.toLowerCase().trim();

    // Extract Message-ID and In-Reply-To from raw headers string
    const headers: string = body.headers ?? '';
    const msgIdMatch = headers.match(/^Message-ID:\s*<([^>]+)>/im);
    const inReplyToMatch = headers.match(/^In-Reply-To:\s*<([^>]+)>/im);
    const messageId = msgIdMatch ? msgIdMatch[1] : `${Date.now()}@zuti`;
    const inReplyTo = inReplyToMatch ? inReplyToMatch[1] : undefined;

    const subject = body.subject ?? '(no subject)';
    const rawText = body.text ?? body.html?.replace(/<[^>]+>/g, ' ').trim() ?? '';

    // Strip quoted reply history: remove "On ... wrote:" delimiter and everything after,
    // then strip any remaining lines starting with ">" (inline quotes)
    const stripped = rawText
      .replace(/^On\s.+?wrote:\s*$/ms, '')   // "On Tue, 19 May ... wrote:"
      .split('\n')
      .filter(line => !line.trimStart().startsWith('>'))
      .join('\n')
      .trim();
    const bodyText = stripped || rawText.trim();  // fallback to raw if stripping removes everything

    if (!toAddress || !fromEmail || !bodyText.trim()) return { ok: true };

    // Find bot by toAddress — checks Zuti-hosted OR custom domain address
    const bot = await this.prisma.bot.findFirst({
      where: {
        isActive: true,
        emailEnabled: true,
        OR: [
          { emailAddress: toAddress },
          { customEmailAddress: toAddress, customEmailVerified: true },
        ],
      },
    });

    if (!bot) {
      this.logger.warn(`No active email-enabled bot found for address: ${toAddress}`);
      return { ok: true };
    }

    const job: EmailMessageJob = {
      botId: bot.id,
      organizationId: bot.organizationId,
      toAddress,
      fromEmail,
      fromName,
      subject,
      bodyText,
      messageId,
      inReplyTo,
    };

    await this.emailQueue.add(job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return { ok: true };
  }

  @Get('whatsapp/:botId')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyWhatsAppWebhook(
    @Param('botId') botId: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, isActive: true, whatsappEnabled: true, whatsappChannelIdentifier: { not: null } },
      select: { whatsappVerifyToken: true },
    });

    if (!bot || mode !== 'subscribe' || !verifyToken || verifyToken !== bot.whatsappVerifyToken) {
      throw new ForbiddenException('forbidden');
    }

    return challenge ?? 'ok';
  }

  @Post('whatsapp/:botId')
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async handleWhatsAppInbound(
    @Param('botId') botId: string,
    @Headers('x-hub-signature-256') metaSignature: string | undefined,
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Req() req: any,
    @Body() body: Record<string, any>,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, isActive: true, whatsappEnabled: true, whatsappChannelIdentifier: { not: null } },
    });

    if (!bot) {
      this.logger.warn(`Received WhatsApp webhook for unknown/inactive bot: ${botId}`);
      return { ok: true };
    }

    const config = extractWhatsAppConfig(bot.whatsappConfig);
    if (bot.whatsappProvider === 'META') {
      const appSecret = typeof config.appSecret === 'string' ? config.appSecret.trim() : '';
      if (!appSecret || !verifyMetaWebhookSignature(appSecret, req?.rawBody ?? Buffer.from(''), metaSignature)) {
        this.logger.warn(`Meta WhatsApp signature mismatch for bot ${botId}`);
        return { ok: true };
      }

      const entries = Array.isArray(body.entry) ? body.entry : [];
      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value ?? {};
          const contacts = Array.isArray(value.contacts) ? value.contacts : [];
          const messages = Array.isArray(value.messages) ? value.messages : [];
          for (const message of messages) {
            const text = message?.text?.body;
            if (!text || message?.type !== 'text') continue;
            const contact = contacts.find((item: any) => item?.wa_id === message?.from);
            const job: WhatsAppMessageJob = {
              botId: bot.id,
              organizationId: bot.organizationId,
              provider: 'META',
              userId: String(message.from),
              phoneNumber: String(message.from),
              profileName: contact?.profile?.name,
              messageId: String(message.id),
              text,
            };
            await this.whatsappQueue.add(job, {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: true,
              removeOnFail: false,
            });
          }
        }
      }

      return { ok: true };
    }

    if (bot.whatsappProvider === 'TWILIO') {
      const authToken = typeof config.authToken === 'string' ? config.authToken.trim() : '';
      const url = this.getTwilioSignatureUrl(req);
      if (!authToken || !verifyTwilioWebhookSignature(authToken, twilioSignature, url, body as Record<string, string | string[] | undefined>)) {
        this.logger.warn(`Twilio WhatsApp signature mismatch for bot ${botId}`);
        return { ok: true };
      }

      const text = typeof body.Body === 'string' ? body.Body.trim() : '';
      if (!text) return { ok: true };

      const job: WhatsAppMessageJob = {
        botId: bot.id,
        organizationId: bot.organizationId,
        provider: 'TWILIO',
        userId: typeof body.WaId === 'string' ? body.WaId : String(body.From ?? ''),
        phoneNumber: typeof body.From === 'string' ? body.From.replace(/^whatsapp:/, '') : null,
        profileName: typeof body.ProfileName === 'string' ? body.ProfileName : undefined,
        messageId: typeof body.MessageSid === 'string' ? body.MessageSid : `${Date.now()}`,
        text,
      };

      await this.whatsappQueue.add(job, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    }

    return { ok: true };
  }

  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handlePaystack(
    @Headers('x-paystack-signature') signature: string | undefined,
    @Req() req: any,
    @Body() payload: any,
  ) {
    const rawBody = req?.rawBody as Buffer | undefined;
    return this.billing.handlePaystackWebhook(signature, rawBody ?? Buffer.from(''), payload);
  }
}
