import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { ACTION_FORWARDING_QUEUE } from '../queue/queue.module';
import { ActionForwardingService } from './action-forwarding.service';
import { ActionForwardingProcessor } from './action-forwarding.processor';
import { ActionForwardingController } from './action-forwarding.controller';
import { InternalToolsController } from './internal-tools.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { TeamChatModule } from '../team-chat/team-chat.module';
import { CommerceModule } from '../commerce/commerce.module';
import { CustomersModule } from '../customers/customers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [HttpModule, BullModule.registerQueue({ name: ACTION_FORWARDING_QUEUE }), NotificationsModule, RegistrationsModule, TeamChatModule, CommerceModule, CustomersModule, OrganizationsModule, EventsModule],
  controllers: [ActionForwardingController, InternalToolsController],
  providers: [ActionForwardingService, ActionForwardingProcessor],
  exports: [ActionForwardingService],
})
export class ActionForwardingModule {}
