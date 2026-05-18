import {
  Controller, Post, Param, Body, Headers,
  Logger, HttpCode, HttpStatus, UseInterceptors,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
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
    const bodyText = body.text ?? body.html?.replace(/<[^>]+>/g, ' ').trim() ?? '';

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
