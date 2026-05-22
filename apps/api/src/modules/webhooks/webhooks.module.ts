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
import { TeamChatModule } from '../team-chat/team-chat.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { BillingModule } from '../billing/billing.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    HttpModule,
    BullModule.registerQueue({ name: TELEGRAM_QUEUE }),
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
    OrganizationsModule,
    NotificationsModule,
    CannedResponsesModule,
    TeamChatModule,
    AiUsageModule,
    BillingModule,
    ActivityModule,
  ],
  controllers: [WebhooksController],
  providers: [TelegramProcessor, EmailProcessor],
})
export class WebhooksModule {}
