import { Controller, Get, Patch, Post, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CustomerLifecycle } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';
import { CustomersService } from './customers.service';
import { UpdateCustomerDto, MergeCustomerDto } from './dto/customers.dto';

@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@Controller('organizations/:id/customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  list(
    @Param('id') orgId: string,
    @Query('search') search?: string,
    @Query('stage') stage?: CustomerLifecycle,
    @Query('includeLeads') includeLeads?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list(orgId, {
      search,
      stage: stage && ['LEAD', 'ENGAGED', 'CUSTOMER'].includes(stage) ? stage : undefined,
      includeLeads: includeLeads === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':customerId')
  getProfile(@Param('id') orgId: string, @Param('customerId') customerId: string) {
    return this.svc.getProfile(orgId, customerId);
  }

  @Get(':customerId/export')
  @RequireRole('OWNER', 'ADMIN')
  export(@Param('id') orgId: string, @Param('customerId') customerId: string) {
    return this.svc.export(orgId, customerId);
  }

  @Patch(':customerId')
  update(@Param('id') orgId: string, @Param('customerId') customerId: string, @Body() dto: UpdateCustomerDto) {
    return this.svc.update(orgId, customerId, dto);
  }

  @Post(':customerId/merge')
  @RequireRole('OWNER', 'ADMIN')
  merge(@Param('id') orgId: string, @Param('customerId') customerId: string, @Body() dto: MergeCustomerDto) {
    return this.svc.merge(orgId, customerId, dto.absorbedId);
  }

  @Delete(':customerId')
  @RequireRole('OWNER', 'ADMIN')
  remove(@Param('id') orgId: string, @Param('customerId') customerId: string) {
    return this.svc.remove(orgId, customerId);
  }
}
