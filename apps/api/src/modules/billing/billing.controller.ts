import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { BillingService } from './billing.service';
import { PricingMarket } from '../pricing/pricing.service';

class PackCheckoutDto {
  @IsString()
  @IsIn(['NG', 'US'])
  declare market: PricingMarket;

  @IsString()
  declare packId: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  declare callbackUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-zA-Z0-9:_-]+$/)
  declare idempotencyKey?: string;
}

class CommitmentCheckoutDto {
  @IsString()
  @IsIn(['NG', 'US'])
  declare market: PricingMarket;

  @IsString()
  declare subscriptionId: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  declare callbackUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-zA-Z0-9:_-]+$/)
  declare idempotencyKey?: string;
}

class VerifyCheckoutDto {
  @IsString()
  @Matches(/^zuti_[0-9]{13}_[a-f0-9]{12}$/)
  declare reference: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN')
@Controller('organizations/:id/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('wallet')
  @ApiOperation({ summary: 'Get organization wallet balance and recent credit activity' })
  wallet(@Param('id') orgId: string) {
    return this.billing.getWallet(orgId);
  }

  @Post('checkout/pack')
  @ApiOperation({ summary: 'Initialize Paystack checkout for a one-time credit pack top-up' })
  checkoutPack(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: PackCheckoutDto,
  ) {
    return this.billing.initializePackCheckout(user.id, orgId, dto);
  }

  @Post('checkout/commitment')
  @ApiOperation({ summary: 'Initialize Paystack checkout for a monthly prepaid credit commitment' })
  checkoutCommitment(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CommitmentCheckoutDto,
  ) {
    return this.billing.initializeCommitmentCheckout(user.id, orgId, dto);
  }

  @Post('checkout/verify')
  @ApiOperation({ summary: 'Verify a Paystack transaction reference and apply credits once' })
  verifyCheckout(@Param('id') orgId: string, @Body() dto: VerifyCheckoutDto) {
    return this.billing.verifyAndApply(orgId, dto.reference);
  }
}
