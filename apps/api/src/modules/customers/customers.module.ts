import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';

/**
 * Customer hub: the unified per-org record of the people a business serves. Exposes the
 * identity-resolution engine (used by ingest/backfill) + the dashboard list/profile/CRM API.
 * AI enrichment builds on top. See CUSTOMER_HUB_PLAN.md.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomerIdentityService, CustomersService],
  exports: [CustomerIdentityService, CustomersService],
})
export class CustomersModule {}
