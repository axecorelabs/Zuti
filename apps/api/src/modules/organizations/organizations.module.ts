import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsScheduler } from './organizations.scheduler';
import { ActivityModule } from '../activity/activity.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [ActivityModule, MailModule, HttpModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationsScheduler],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
