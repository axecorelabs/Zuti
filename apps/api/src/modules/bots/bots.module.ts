import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { WidgetController } from './widget.controller';

@Module({
  imports: [HttpModule],
  controllers: [BotsController, WidgetController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
