import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationsScheduler } from './conversations.scheduler';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityModule } from '../activity/activity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EventsModule } from '../events/events.module';
import { TeamChatModule } from '../team-chat/team-chat.module';

@Module({
  imports: [HttpModule, NotificationsModule, ActivityModule, forwardRef(() => OrganizationsModule), EventsModule, TeamChatModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsScheduler],
  exports: [ConversationsService],
})
export class ConversationsModule {}
