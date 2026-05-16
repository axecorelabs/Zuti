import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';

@Module({
  imports: [HttpModule],
  controllers: [BotsController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
