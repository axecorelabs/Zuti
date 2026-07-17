import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { PricingModule } from '../pricing/pricing.module';
import { ActivityModule } from '../activity/activity.module';
import { RECEIPTS_QUEUE } from '../queue/queue.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingScheduler } from './billing.scheduler';

@Module({
  imports: [
    HttpModule,
    PricingModule,
    ActivityModule,
    BullModule.registerQueue({ name: RECEIPTS_QUEUE }),
  ],
  controllers: [BillingController],
  providers: [BillingService, BillingScheduler],
  exports: [BillingService],
})
export class BillingModule {}
