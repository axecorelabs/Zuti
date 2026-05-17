import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsIn, IsArray, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';
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
}
