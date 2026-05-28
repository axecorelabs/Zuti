import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { ACTION_FORWARDING_QUEUE } from '../queue/queue.module';
import { ActionForwardingService } from './action-forwarding.service';
import { ActionForwardingProcessor } from './action-forwarding.processor';
import { ActionForwardingController } from './action-forwarding.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [HttpModule, BullModule.registerQueue({ name: ACTION_FORWARDING_QUEUE }), NotificationsModule],
  controllers: [ActionForwardingController],
  providers: [ActionForwardingService, ActionForwardingProcessor],
  exports: [ActionForwardingService],
})
export class ActionForwardingModule {}
