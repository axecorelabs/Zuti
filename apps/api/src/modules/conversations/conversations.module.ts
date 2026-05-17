import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [HttpModule, NotificationsModule, ActivityModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
