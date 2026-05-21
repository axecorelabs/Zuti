import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from './billing.service';

@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(private readonly billing: BillingService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async processCommitmentRenewals() {
    try {
      await this.billing.runDueCommitmentRenewals();
    } catch (error) {
      this.logger.error(`Commitment renewal cycle failed: ${(error as Error).message}`);
    }
  }
}
