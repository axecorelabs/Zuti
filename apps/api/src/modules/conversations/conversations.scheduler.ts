import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

// Conversations that are PENDING (awaiting CSAT response) for longer than this
// will be auto-closed as RESOLVED. They are excluded from the CSAT sample since
// no explicit rating was collected.
const AUTO_CLOSE_HOURS = 24;

@Injectable()
export class ConversationsScheduler {
  private readonly logger = new Logger(ConversationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  /** Runs every hour. Closes stale PENDING/awaitingCsat conversations. */
  @Cron(CronExpression.EVERY_HOUR)
  async autoCloseStaleCsatConversations() {
    const cutoff = new Date(Date.now() - AUTO_CLOSE_HOURS * 60 * 60 * 1000);

    // Find PENDING conversations waiting for CSAT response that have gone quiet
    const stale = await this.prisma.conversation.findMany({
      where: {
        status: 'PENDING',
        lastMessageAt: { lt: cutoff },
      },
      select: { id: true, organizationId: true, metadata: true },
    });

    // Filter to only those actually awaiting CSAT (not manually set to PENDING)
    const toClose = stale.filter((c) => {
      const m = c.metadata as Record<string, unknown> | null;
      return m?.awaitingCsat === true;
    });

    if (toClose.length === 0) return;

    this.logger.log(`Auto-closing ${toClose.length} stale CSAT-awaiting conversation(s)`);

    for (const conv of toClose) {
      const meta = (conv.metadata as Record<string, unknown>) ?? {};
      await this.prisma.conversation.update({
        where: { id: conv.id },
        data: {
          status: 'RESOLVED',
          // Remove awaitingCsat flag; no csatRating set → excluded from CSAT sample
          metadata: { ...meta, awaitingCsat: false, autoClosedAt: new Date().toISOString() },
        },
      });
      this.events.emitConversationUpdate(conv.organizationId, {
        conversationId: conv.id,
        status: 'RESOLVED',
      });
    }
  }
}
