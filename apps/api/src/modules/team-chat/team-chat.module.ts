import { Module } from '@nestjs/common';
import { TeamChatController } from './team-chat.controller';
import { TeamChatService } from './team-chat.service';
import { EventsModule } from '../events/events.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';

@Module({
  imports: [EventsModule, AiUsageModule],
  controllers: [TeamChatController],
  providers: [TeamChatService],
  exports: [TeamChatService],
})
export class TeamChatModule {}
