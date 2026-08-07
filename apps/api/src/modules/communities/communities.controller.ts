import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto, UpdateCommunityDto } from './dto/community.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';

@ApiTags('communities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@Controller('organizations/:id/communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Post()
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Set up this organization\'s Telegram community, attached to an already-connected bot' })
  create(@Param('id') orgId: string, @Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(orgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get this organization\'s community, if one is set up' })
  findOne(@Param('id') orgId: string) {
    return this.communitiesService.findForOrg(orgId);
  }

  @Patch(':communityId')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update the community' })
  update(@Param('id') orgId: string, @Param('communityId') communityId: string, @Body() dto: UpdateCommunityDto) {
    return this.communitiesService.update(orgId, communityId, dto);
  }

  @Delete(':communityId')
  @RequireRole('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the community' })
  remove(@Param('id') orgId: string, @Param('communityId') communityId: string) {
    return this.communitiesService.remove(orgId, communityId);
  }
}
