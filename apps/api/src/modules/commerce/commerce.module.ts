import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { ActivityModule } from '../activity/activity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RECEIPTS_QUEUE } from '../queue/queue.module';

@Module({
  imports: [
    HttpModule,
    ActivityModule,
    NotificationsModule,
    BullModule.registerQueue({ name: RECEIPTS_QUEUE }),
  ],
  controllers: [CommerceController],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}
