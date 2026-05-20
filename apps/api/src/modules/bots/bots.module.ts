import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { WidgetController } from './widget.controller';
import { EventsModule } from '../events/events.module';
import { CannedResponsesModule } from '../canned-responses/canned-responses.module';

@Module({
  imports: [HttpModule, EventsModule, CannedResponsesModule],
  controllers: [BotsController, WidgetController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
