import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN', 'AGENT')
@Controller('organizations/:id/activity')
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  @Get()
  @ApiOperation({ summary: 'Get activity log for the organization, scoped by role' })
  @ApiQuery({ name: 'page', required: false, description: '1-based page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (max 200)' })
  list(
    @Param('id') orgId: string,
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const query = { page, limit };
    if (req.memberRole === 'AGENT') {
      return this.service.listForMember(orgId, req.user.id, query);
    }

    return this.service.list(orgId, query);
  }
}
