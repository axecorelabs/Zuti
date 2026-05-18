import {
  Controller, Post, Param, Body, Headers,
  Logger, HttpCode, HttpStatus,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { TELEGRAM_QUEUE, EMAIL_QUEUE } from '../queue/queue.module';
import { TelegramMessageJob } from '../queue/telegram.processor';
import { EmailMessageJob } from '../queue/email.processor';

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TELEGRAM_QUEUE) private readonly telegramQueue: Queue,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
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

  // ── Email (Brevo Inbound Parsing) ─────────────────────────────────────────
  // Brevo POSTs JSON to this single endpoint.
  // The bot is identified by the `To[0].Address` field.

  @Post('email')
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async handleEmailInbound(@Body() body: Record<string, any>) {
    // Brevo sends JSON: { From: { Name, Address }, To: [{ Address }], Subject, TextBody, HtmlBody, MessageId, InReplyTo }
    const fromEmail: string = (body?.From?.Address ?? '').toLowerCase().trim();
    const fromName: string = body?.From?.Name ?? '';
    const toAddress: string = (body?.To?.[0]?.Address ?? '').toLowerCase().trim();
    const subject: string = body?.Subject ?? '(no subject)';
    const bodyText: string = body?.TextBody ?? body?.HtmlBody?.replace(/<[^>]+>/g, ' ').trim() ?? '';

    // Strip angle brackets from MessageId/InReplyTo if present
    const rawMessageId: string = body?.MessageId ?? '';
    const messageId = rawMessageId.replace(/^<|>$/g, '') || `${Date.now()}@brevo`;

    const rawInReplyTo: string = body?.InReplyTo ?? '';
    const inReplyTo = rawInReplyTo.replace(/^<|>$/g, '') || undefined;

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
}
