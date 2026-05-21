import { Controller, Get, Param, Post, Query, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { PricingMarket, PricingService } from './pricing.service';

class QuotePurchaseDto {
  @IsString()
  @IsIn(['NG', 'US'])
  declare market: PricingMarket;

  @IsString()
  declare packId: string;
}

@ApiTags('pricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN')
@Controller('organizations/:id/pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Get pricing catalog for a market' })
  @ApiQuery({ name: 'market', required: false, description: 'NG or US (default NG)' })
  catalog(@Query('market') market?: string) {
    const selected = market === 'US' ? 'US' : 'NG';
    return this.pricing.getCatalog(selected);
  }

  @Get('estimates')
  @ApiOperation({ summary: 'Estimate how long available credit packs can last based on recent usage' })
  @ApiQuery({ name: 'market', required: false, description: 'NG or US (default NG)' })
  estimates(@Param('id') orgId: string, @Query('market') market?: string) {
    const selected = market === 'US' ? 'US' : 'NG';
    return this.pricing.buildEstimates(orgId, selected);
  }

  @Post('quote')
  @ApiOperation({ summary: 'Generate a server-validated quote for a credit pack purchase' })
  quote(@Param('id') orgId: string, @Body() dto: QuotePurchaseDto) {
    return this.pricing.quotePackPurchase(orgId, dto.market, dto.packId);
  }
}
