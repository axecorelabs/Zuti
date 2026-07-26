import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { CommerceController } from './commerce.controller';
import { CommercePublicController } from './commerce-public.controller';
import { CommerceService } from './commerce.service';
import { CommerceScheduler } from './commerce.scheduler';
import { ActivityModule } from '../activity/activity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RECEIPTS_QUEUE } from '../queue/queue.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    HttpModule,
    ActivityModule,
    NotificationsModule,
    CustomersModule,
    BullModule.registerQueue({ name: RECEIPTS_QUEUE }),
  ],
  controllers: [CommerceController, CommercePublicController],
  providers: [CommerceService, CommerceScheduler],
  exports: [CommerceService],
})
export class CommerceModule {}
