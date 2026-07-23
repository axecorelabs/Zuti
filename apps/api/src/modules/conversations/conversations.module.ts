import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConversationsController } from './conversations.controller';
import { InternalConversationsController } from './internal-conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationsScheduler } from './conversations.scheduler';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityModule } from '../activity/activity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EventsModule } from '../events/events.module';
import { TeamChatModule } from '../team-chat/team-chat.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [HttpModule, NotificationsModule, ActivityModule, forwardRef(() => OrganizationsModule), EventsModule, TeamChatModule, AiUsageModule, BillingModule],
  controllers: [ConversationsController, InternalConversationsController],
  providers: [ConversationsService, ConversationsScheduler],
  exports: [ConversationsService],
})
export class ConversationsModule {}
