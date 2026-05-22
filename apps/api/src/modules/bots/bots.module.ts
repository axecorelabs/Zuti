import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { WidgetController } from './widget.controller';
import { EventsModule } from '../events/events.module';
import { CannedResponsesModule } from '../canned-responses/canned-responses.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { TeamChatModule } from '../team-chat/team-chat.module';
import { BillingModule } from '../billing/billing.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [HttpModule, EventsModule, CannedResponsesModule, AiUsageModule, TeamChatModule, BillingModule, ActivityModule],
  controllers: [BotsController, WidgetController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
