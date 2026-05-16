import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, InviteMemberDto } from './dto/organization.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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

  @Post(':id/members')
  @ApiOperation({ summary: 'Invite a member to the organization' })
  inviteMember(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: InviteMemberDto,
  ) {
    return this.organizationsService.inviteMember(orgId, user.id, dto);
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
}
