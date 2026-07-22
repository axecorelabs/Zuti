import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RegistrationsService } from './registrations.service';

@Injectable()
export class RegistrationsScheduler {
  private readonly logger = new Logger(RegistrationsScheduler.name);

  constructor(private readonly registrations: RegistrationsService) {}

  /**
   * Every 5 minutes, reconcile registration payments against Paystack so a paid registration
   * is never stranded when the webhook or browser-callback is missed. This is the guarantee;
   * the webhook/callback are just the fast path.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePayments() {
    try {
      await this.registrations.reconcilePendingPayments();
    } catch (err) {
      this.logger.warn(`Payment reconciliation sweep failed: ${String(err)}`);
    }
  }
}
