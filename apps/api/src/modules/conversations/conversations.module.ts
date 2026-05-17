import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityModule } from '../activity/activity.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [HttpModule, NotificationsModule, ActivityModule, forwardRef(() => OrganizationsModule)],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
