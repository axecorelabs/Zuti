import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { BotsModule } from './modules/bots/bots.module';
import { QueueModule } from './modules/queue/queue.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { EventsModule } from './modules/events/events.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EventsModule,
    AuthModule,
    OrganizationsModule,
    BotsModule,
    QueueModule,
    WebhooksModule,
    ConversationsModule,
    KnowledgeModule,
  ],
  providers: [
    // Apply JWT guard globally — use @Public() to opt out
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
