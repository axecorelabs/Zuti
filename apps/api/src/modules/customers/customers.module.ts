import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerIdentityService } from './customer-identity.service';

/**
 * Customer hub: the unified per-org record of the people a business serves. Stage 1 exposes the
 * identity-resolution engine; list/profile API + AI enrichment build on top. See CUSTOMER_HUB_PLAN.md.
 */
@Module({
  imports: [PrismaModule],
  providers: [CustomerIdentityService],
  exports: [CustomerIdentityService],
})
export class CustomersModule {}
