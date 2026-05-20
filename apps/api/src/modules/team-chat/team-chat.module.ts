import { Module } from '@nestjs/common';
import { TeamChatController } from './team-chat.controller';
import { TeamChatService } from './team-chat.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [TeamChatController],
  providers: [TeamChatService],
  exports: [TeamChatService],
})
export class TeamChatModule {}
