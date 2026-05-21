import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';
import { AiUsageService } from './ai-usage.service';

@ApiTags('ai-usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN')
@Controller('organizations/:id/ai-usage')
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Summarize AI usage by usage bucket' })
  @ApiQuery({ name: 'days', required: false })
  summary(@Param('id') orgId: string, @Query('days') days?: string) {
    const parsed = days ? Number(days) : 30;
    return this.usage.summarize(orgId, Number.isFinite(parsed) ? parsed : 30);
  }
}
