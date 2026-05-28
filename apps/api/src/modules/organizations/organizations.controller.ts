import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsIn, IsArray, IsOptional, IsBoolean, IsInt, Min, Max, IsObject } from 'class-validator';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/organization.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class UpdateMemberRoleDto {
  @IsString()
  @IsIn(['ADMIN', 'AGENT'])
  declare role: string;
}

class UpdateAgentProfileDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare specializations?: string[];

  @IsOptional()
  @IsBoolean()
  declare isAvailable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  declare maxConcurrentConversations?: number;
}

class CreateContactEndpointDto {
  @IsString()
  declare label: string;

  @IsString()
  @IsIn(['TELEGRAM', 'EMAIL'])
  declare channel: 'TELEGRAM' | 'EMAIL';

  @IsString()
  declare destination: string;

  @IsOptional()
  @IsString()
  declare userId?: string;

  @IsOptional()
  @IsBoolean()
  declare isPrimary?: boolean;

  @IsOptional()
  @IsObject()
  declare metadata?: Record<string, unknown>;
}

class UpdateContactEndpointDto {
  @IsOptional()
  @IsString()
  declare label?: string;

  @IsOptional()
  @IsString()
  @IsIn(['TELEGRAM', 'EMAIL'])
  declare channel?: 'TELEGRAM' | 'EMAIL';

  @IsOptional()
  @IsString()
  declare destination?: string;

  @IsOptional()
  @IsString()
  declare userId?: string | null;

  @IsOptional()
  @IsBoolean()
  declare isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  declare isPrimary?: boolean;

  @IsOptional()
  @IsObject()
  declare metadata?: Record<string, unknown>;
}

class CreateContactPolicyDto {
  @IsString()
  declare name: string;

  @IsString()
  @IsIn(['ORGANIZATION', 'BOT'])
  declare scope: 'ORGANIZATION' | 'BOT';

  @IsOptional()
  @IsString()
  declare endpointId?: string;

  @IsOptional()
  @IsString()
  declare botId?: string;

  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;

  @IsOptional()
  @IsObject()
  declare rules?: Record<string, unknown>;
}

class UpdateContactPolicyDto {
  @IsOptional()
  @IsString()
  declare name?: string;

  @IsOptional()
  @IsString()
  declare endpointId?: string | null;

  @IsOptional()
  @IsString()
  declare botId?: string | null;

  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;

  @IsOptional()
  @IsObject()
  declare rules?: Record<string, unknown>;
}

class ListOperationalRecordsQueryDto {
  @IsOptional()
  @IsString()
  declare botId?: string;

  @IsOptional()
  @IsString()
  declare status?: string;

  @IsOptional()
  @IsString()
  declare actionType?: string;

  @IsOptional()
  @IsString()
  declare q?: string;

  @IsOptional()
  @IsString()
  declare limit?: string;

  @IsOptional()
  @IsString()
  declare page?: string;
}

class UpdateActionTaskStatusDto {
  @IsString()
  @IsIn(['ACKNOWLEDGED', 'COMPLETED'])
  declare status: 'ACKNOWLEDGED' | 'COMPLETED';
}

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all organizations for current user' })
  findAll(@CurrentUser() user: { id: string }) {
    return this.organizationsService.findAllForUser(user.id);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get organization by slug' })
  findOne(@Param('slug') slug: string, @CurrentUser() user: { id: string }) {
    return this.organizationsService.findOne(slug, user.id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List members of an organization (OWNER/ADMIN only)' })
  listMembers(@Param('id') orgId: string, @CurrentUser() user: { id: string }) {
    return this.organizationsService.listMembers(orgId, user.id);
  }

  @Patch(':id/members/:userId/role')
  @ApiOperation({ summary: 'Update a member role (OWNER only)' })
  updateMemberRole(
    @Param('id') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(orgId, user.id, targetUserId, dto.role);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from the organization' })
  removeMember(
    @Param('id') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.organizationsService.removeMember(orgId, user.id, targetUserId);
  }

  @Patch(':id/members/:userId/profile')
  @ApiOperation({ summary: 'Update agent routing profile (specializations, availability, capacity)' })
  updateAgentProfile(
    @Param('id') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateAgentProfileDto,
  ) {
    return this.organizationsService.updateAgentProfile(orgId, user.id, targetUserId, dto);
  }

  @Get(':id/contact-endpoints')
  @ApiOperation({ summary: 'List contact endpoints for an organization (OWNER/ADMIN only)' })
  listContactEndpoints(@Param('id') orgId: string, @CurrentUser() user: { id: string }) {
    return this.organizationsService.listContactEndpoints(orgId, user.id);
  }

  @Post(':id/contact-endpoints')
  @ApiOperation({ summary: 'Create a contact endpoint (OWNER/ADMIN only)' })
  createContactEndpoint(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateContactEndpointDto,
  ) {
    return this.organizationsService.createContactEndpoint(orgId, user.id, dto);
  }

  @Patch(':id/contact-endpoints/:endpointId')
  @ApiOperation({ summary: 'Update a contact endpoint (OWNER/ADMIN only)' })
  updateContactEndpoint(
    @Param('id') orgId: string,
    @Param('endpointId') endpointId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateContactEndpointDto,
  ) {
    return this.organizationsService.updateContactEndpoint(orgId, user.id, endpointId, dto);
  }

  @Delete(':id/contact-endpoints/:endpointId')
  @ApiOperation({ summary: 'Delete a contact endpoint (OWNER/ADMIN only)' })
  deleteContactEndpoint(
    @Param('id') orgId: string,
    @Param('endpointId') endpointId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.organizationsService.deleteContactEndpoint(orgId, user.id, endpointId);
  }

  @Get(':id/contact-policies')
  @ApiOperation({ summary: 'List contact policies for an organization (OWNER/ADMIN only)' })
  listContactPolicies(@Param('id') orgId: string, @CurrentUser() user: { id: string }) {
    return this.organizationsService.listContactPolicies(orgId, user.id);
  }

  @Post(':id/contact-policies')
  @ApiOperation({ summary: 'Create a contact policy (OWNER/ADMIN only)' })
  createContactPolicy(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateContactPolicyDto,
  ) {
    return this.organizationsService.createContactPolicy(orgId, user.id, dto);
  }

  @Patch(':id/contact-policies/:policyId')
  @ApiOperation({ summary: 'Update a contact policy (OWNER/ADMIN only)' })
  updateContactPolicy(
    @Param('id') orgId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateContactPolicyDto,
  ) {
    return this.organizationsService.updateContactPolicy(orgId, user.id, policyId, dto);
  }

  @Delete(':id/contact-policies/:policyId')
  @ApiOperation({ summary: 'Delete a contact policy (OWNER/ADMIN only)' })
  deleteContactPolicy(
    @Param('id') orgId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.organizationsService.deleteContactPolicy(orgId, user.id, policyId);
  }

  @Get(':id/action-tasks')
  @ApiOperation({ summary: 'List action tasks for an organization' })
  listActionTasks(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: ListOperationalRecordsQueryDto,
  ) {
    return this.organizationsService.listActionTasks(orgId, user.id, query);
  }

  @Patch(':id/action-tasks/:taskId/status')
  @ApiOperation({ summary: 'Update action task status (ACKNOWLEDGED/COMPLETED)' })
  updateActionTaskStatus(
    @Param('id') orgId: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateActionTaskStatusDto,
  ) {
    return this.organizationsService.updateActionTaskStatus(orgId, user.id, taskId, dto.status);
  }

  @Get(':id/leads')
  @ApiOperation({ summary: 'List leads for an organization' })
  listLeads(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: ListOperationalRecordsQueryDto,
  ) {
    return this.organizationsService.listLeads(orgId, user.id, query);
  }

  @Get(':id/bookings')
  @ApiOperation({ summary: 'List bookings for an organization' })
  listBookings(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: ListOperationalRecordsQueryDto,
  ) {
    return this.organizationsService.listBookings(orgId, user.id, query);
  }

  @Get(':id/sales-orders')
  @ApiOperation({ summary: 'List sales orders for an organization' })
  listSalesOrders(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: ListOperationalRecordsQueryDto,
  ) {
    return this.organizationsService.listSalesOrders(orgId, user.id, query);
  }

  @Get(':id/technical-issues')
  @ApiOperation({ summary: 'List technical issues for an organization' })
  listTechnicalIssues(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: ListOperationalRecordsQueryDto,
  ) {
    return this.organizationsService.listTechnicalIssues(orgId, user.id, query);
  }
}
