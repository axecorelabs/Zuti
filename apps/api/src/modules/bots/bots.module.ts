import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { WidgetController } from './widget.controller';
import { EventsModule } from '../events/events.module';
import { CannedResponsesModule } from '../canned-responses/canned-responses.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { TeamChatModule } from '../team-chat/team-chat.module';
import { BillingModule } from '../billing/billing.module';
import { ActivityModule } from '../activity/activity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ActionForwardingModule } from '../action-forwarding/action-forwarding.module';
import { CustomersModule } from '../customers/customers.module';
import { MARKETING_QUEUE } from '../queue/queue.module';
import { MarketingBroadcastProcessor } from '../queue/marketing-broadcast.processor';

@Module({
  imports: [HttpModule, EventsModule, CannedResponsesModule, AiUsageModule, TeamChatModule, BillingModule, ActivityModule, OrganizationsModule, ActionForwardingModule, CustomersModule, BullModule.registerQueue({ name: MARKETING_QUEUE })],
  controllers: [BotsController, WidgetController],
  providers: [BotsService, MarketingBroadcastProcessor],
  exports: [BotsService],
})
export class BotsModule {}
