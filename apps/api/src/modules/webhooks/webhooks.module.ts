import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { WebhooksController } from './webhooks.controller';
import { TelegramProcessor } from '../queue/telegram.processor';
import { TELEGRAM_QUEUE } from '../queue/queue.module';

@Module({
  imports: [
    HttpModule,
    BullModule.registerQueue({ name: TELEGRAM_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [TelegramProcessor],
})
export class WebhooksModule {}
