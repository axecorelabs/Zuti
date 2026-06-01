import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { ActivityModule } from '../activity/activity.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [HttpModule, ActivityModule, NotificationsModule],
  controllers: [CommerceController],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}
