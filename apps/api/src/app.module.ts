import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { BotsModule } from './modules/bots/bots.module';
import { QueueModule } from './modules/queue/queue.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { EventsModule } from './modules/events/events.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ActivityModule } from './modules/activity/activity.module';
import { CannedResponsesModule } from './modules/canned-responses/canned-responses.module';
import { TeamChatModule } from './modules/team-chat/team-chat.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),    ScheduleModule.forRoot(),    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    EventsModule,
    AuthModule,
    OrganizationsModule,
    BotsModule,
    QueueModule,
    WebhooksModule,
    ConversationsModule,
    KnowledgeModule,
    InvitationsModule,
    NotificationsModule,
    ActivityModule,
    CannedResponsesModule,
    TeamChatModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Apply JWT guard globally — use @Public() to opt out
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
