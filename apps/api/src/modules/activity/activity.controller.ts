import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN')
@Controller('organizations/:id/activity')
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  @Get()
  @ApiOperation({ summary: 'Get activity log for the organization (OWNER/ADMIN only)' })
  list(@Param('id') orgId: string) {
    return this.service.list(orgId);
  }
}
