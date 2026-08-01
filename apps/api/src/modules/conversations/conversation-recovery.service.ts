import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramProcessor } from '../queue/telegram.processor';
import { WhatsAppProcessor } from '../queue/whatsapp.processor';
import { EmailProcessor } from '../queue/email.processor';

/**
 * Finds and re-answers conversations whose last message is an unanswered customer message —
 * most commonly because the inbound job hit INSUFFICIENT_CREDITS (or another transient failure),
 * exhausted its BullMQ retries within seconds, and nothing ever automatically retried it once the
 * org topped up. The customer's message is already safely stored; this only re-triggers the reply.
 */
@Injectable()
export class ConversationRecoveryService {
  private readonly logger = new Logger(ConversationRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramProcessor,
    private readonly whatsapp: WhatsAppProcessor,
    private readonly email: EmailProcessor,
  ) {}

  /** Conversations left hanging: AI mode, still open/pending, last message from the customer. */
  async findStuckConversations(orgId: string) {
    const candidates = await this.prisma.conversation.findMany({
      where: {
        organizationId: orgId,
        mode: 'AI',
        status: { in: ['OPEN', 'PENDING'] },
        channel: { in: ['TELEGRAM', 'WHATSAPP', 'EMAIL'] },
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        bot: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return candidates
      .filter((c) => {
        const last = c.messages[0];
        if (!last || last.role !== 'USER') return false;
        // A CSAT-awaiting conversation is expected to be sitting on a customer reply — not stuck.
        const meta = (c.metadata as Record<string, unknown>) ?? {};
        if (c.status === 'PENDING' && meta.awaitingCsat === true) return false;
        return true;
      })
      .map((c) => ({
        conversationId: c.id,
        channel: c.channel,
        botId: c.botId,
        botName: c.bot?.name ?? null,
        customerName: c.customerName,
        customerEmail: c.customerEmail,
        lastMessagePreview: c.messages[0].content.slice(0, 140),
        waitingSince: c.messages[0].createdAt,
      }));
  }

  async retryConversation(orgId: string, conversationId: string): Promise<{ ok: boolean; reason?: string }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId: orgId },
      select: { id: true, channel: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    switch (conversation.channel) {
      case 'TELEGRAM':
        return this.telegram.retryReply(conversationId);
      case 'WHATSAPP':
        return this.whatsapp.retryReply(conversationId);
      case 'EMAIL':
        return this.email.retryReply(conversationId);
      default:
        return { ok: false, reason: `Retry not supported for channel ${conversation.channel}` };
    }
  }

  /** Retry every currently-stuck conversation for the org (or a specific subset). Runs sequentially —
   * this fires real messages to real customers, so we favor predictability over throughput. */
  async retryAllStuck(orgId: string, conversationIds?: string[]) {
    const stuck = await this.findStuckConversations(orgId);
    const targets = conversationIds?.length
      ? stuck.filter((c) => conversationIds.includes(c.conversationId))
      : stuck;

    const results: Array<{ conversationId: string; ok: boolean; reason?: string }> = [];
    for (const target of targets) {
      try {
        const result = await this.retryConversation(orgId, target.conversationId);
        results.push({ conversationId: target.conversationId, ...result });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Retry failed for conversation ${target.conversationId}: ${reason}`);
        results.push({ conversationId: target.conversationId, ok: false, reason });
      }
    }

    return {
      attempted: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok),
    };
  }
}
