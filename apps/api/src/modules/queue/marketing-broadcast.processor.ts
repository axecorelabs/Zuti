import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { MARKETING_QUEUE } from './queue.module';

export interface MarketingBroadcastJob {
  broadcastId: string;
}

/**
 * Sends a Tixtron marketing broadcast in the background — moved off the HTTP request path so a
 * large subscriber list can't hang a request past a proxy/browser timeout. Updates the
 * MarketingBroadcast row's sentCount/failedCount after every send so the dashboard can poll live
 * progress, not just a final result.
 */
@Processor(MARKETING_QUEUE)
export class MarketingBroadcastProcessor {
  private readonly logger = new Logger(MarketingBroadcastProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
  ) {}

  @Process()
  async handle(job: Job<MarketingBroadcastJob>) {
    const prismaAny = this.prisma as any;
    const broadcast = await prismaAny.marketingBroadcast.findUnique({ where: { id: job.data.broadcastId } });
    if (!broadcast || broadcast.status === 'SENT') return;

    const bot = await this.prisma.bot.findUnique({ where: { id: broadcast.botId } });
    if (!bot?.telegramToken) {
      await prismaAny.marketingBroadcast.update({ where: { id: broadcast.id }, data: { status: 'FAILED' } });
      this.logger.warn(`Broadcast ${broadcast.id} has no bot/token — marked FAILED`);
      return;
    }

    const distinctCustomers = await prismaAny.commandBotEvent.findMany({
      where: { orgId: broadcast.orgId, botId: broadcast.botId, customerId: { not: null } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    const customerIds: string[] = distinctCustomers.map((c: { customerId: string }) => c.customerId);
    const eligible = customerIds.length === 0 ? [] : await this.prisma.customer.findMany({
      where: { id: { in: customerIds }, orgId: broadcast.orgId, marketingConsentAt: { not: null }, telegramOptOut: false },
      select: { id: true },
    });
    const recipients: Array<{ value: string }> = eligible.length === 0 ? [] : await prismaAny.customerIdentifier.findMany({
      where: { orgId: broadcast.orgId, customerId: { in: eligible.map((c: { id: string }) => c.id) }, type: 'TELEGRAM_CHAT' },
      select: { value: true },
    });

    const text = `${broadcast.message}\n\n— Reply /unsubscribe to stop these messages.`;
    const replyMarkup = broadcast.ctaUrl
      ? { inline_keyboard: [[{ text: broadcast.ctaLabel ?? 'View', url: broadcast.ctaUrl }]] }
      : undefined;

    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      try {
        if (broadcast.imageUrl) {
          await firstValueFrom(
            this.http.post(`https://api.telegram.org/bot${bot.telegramToken}/sendPhoto`, {
              chat_id: r.value,
              photo: broadcast.imageUrl,
              caption: text,
              parse_mode: 'HTML',
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
          );
        } else {
          await firstValueFrom(
            this.http.post(`https://api.telegram.org/bot${bot.telegramToken}/sendMessage`, {
              chat_id: r.value,
              text,
              disable_web_page_preview: true,
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
          );
        }
        sent += 1;
      } catch {
        failed += 1;
      }
      // Live progress — a dashboard poll mid-send sees real counts, not just PENDING vs SENT.
      await prismaAny.marketingBroadcast.update({
        where: { id: broadcast.id },
        data: { recipientCount: recipients.length, sentCount: sent, failedCount: failed },
      }).catch(() => null);
    }

    await prismaAny.marketingBroadcast.update({
      where: { id: broadcast.id },
      data: { status: 'SENT', recipientCount: recipients.length, sentCount: sent, failedCount: failed },
    });
    this.logger.log(`Broadcast ${broadcast.id} sent: ${sent}/${recipients.length} (${failed} failed)`);
  }
}
