import {
  Controller, Post, Param, Body, Headers,
  Logger, HttpCode, HttpStatus, NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { TELEGRAM_QUEUE } from '../queue/queue.module';
import { TelegramMessageJob } from '../queue/telegram.processor';

@ApiExcludeController()
@Controller('webhooks/telegram')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TELEGRAM_QUEUE) private readonly telegramQueue: Queue,
  ) {}

  @Post(':botId')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleTelegramUpdate(
    @Param('botId') botId: string,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Body() update: any,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, isActive: true },
    });

    if (!bot) {
      // Return 200 to prevent Telegram from retrying
      this.logger.warn(`Received webhook for unknown/inactive bot: ${botId}`);
      return { ok: true };
    }

    // Verify secret token when one is set (all bots registered after the security fix will have one)
    if (bot.webhookSecret) {
      if (!secretHeader || secretHeader !== bot.webhookSecret) {
        this.logger.warn(`Webhook secret mismatch for bot ${botId} — request rejected`);
        // Return 200 so Telegram doesn't retry, but silently drop the forged update
        return { ok: true };
      }
    }

    const message = update?.message;
    if (!message?.text) {
      // Non-text update (sticker, photo, etc.) — acknowledge and skip
      return { ok: true };
    }

    const job: TelegramMessageJob = {
      botId: bot.id,
      telegramChatId: String(message.chat.id),
      telegramToken: bot.telegramToken,
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
}
