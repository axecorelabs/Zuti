import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommerceService } from './commerce.service';

@Injectable()
export class CommerceScheduler {
  private readonly logger = new Logger(CommerceScheduler.name);

  constructor(private readonly commerce: CommerceService) {}

  /**
   * Every 5 minutes, reconcile commerce payments against Paystack so a paid order is never stranded
   * when the webhook (or browser callback) is missed. The webhook is the fast path; this is the
   * guarantee.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePayments() {
    try {
      await this.commerce.reconcilePendingCommercePayments();
    } catch (err) {
      this.logger.warn(`Commerce payment reconciliation sweep failed: ${String(err)}`);
    }
  }
}
