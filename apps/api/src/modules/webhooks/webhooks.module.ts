import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { WebhooksController } from './webhooks.controller';
import { TelegramProcessor } from '../queue/telegram.processor';
import { EmailProcessor } from '../queue/email.processor';
import { TELEGRAM_QUEUE, EMAIL_QUEUE } from '../queue/queue.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CannedResponsesModule } from '../canned-responses/canned-responses.module';

@Module({
  imports: [
    HttpModule,
    BullModule.registerQueue({ name: TELEGRAM_QUEUE }),
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
    OrganizationsModule,
    NotificationsModule,
    CannedResponsesModule,
  ],
  controllers: [WebhooksController],
  providers: [TelegramProcessor, EmailProcessor],
})
export class WebhooksModule {}
