import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrganizationsService } from './organizations.service';

@Injectable()
export class OrganizationsScheduler {
  private readonly logger = new Logger(OrganizationsScheduler.name);

  constructor(private readonly organizations: OrganizationsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeDeletedOrganizations() {
    try {
      await this.organizations.purgeExpiredDeletions();
    } catch (error) {
      this.logger.error(`Org purge sweep failed: ${(error as Error).message}`);
    }
  }
}
