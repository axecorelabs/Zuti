import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { ActionForwardingService } from './action-forwarding.service';

class DeliveryWebhookEventDto {
  @IsString()
  declare organizationId: string;

  @IsString()
  @IsIn(['DELIVERED', 'ACKNOWLEDGED', 'COMPLETED', 'FAILED'])
  declare event: 'DELIVERED' | 'ACKNOWLEDGED' | 'COMPLETED' | 'FAILED';

  @IsOptional()
  @IsString()
  declare actionTaskId?: string;

  @IsOptional()
  @IsString()
  declare deliveryId?: string;

  @IsOptional()
  @IsString()
  declare providerMessageId?: string;

  @IsOptional()
  @IsString()
  declare occurredAt?: string;

  @IsOptional()
  @IsObject()
  declare metadata?: Record<string, unknown>;
}

@ApiExcludeController()
@Controller('action-forwarding')
export class ActionForwardingController {
  constructor(private readonly forwarding: ActionForwardingService) {}

  @Post('webhooks/delivery')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleDeliveryEvent(
    @Headers('x-action-forwarding-secret') providedSecret: string | undefined,
    @Body() payload: DeliveryWebhookEventDto,
  ) {
    const expectedSecret = process.env.ACTION_FORWARDING_WEBHOOK_SECRET;
    if (!expectedSecret) {
      throw new ServiceUnavailableException('ACTION_FORWARDING_WEBHOOK_SECRET is not configured');
    }
    if (!providedSecret || providedSecret !== expectedSecret) {
      throw new ForbiddenException('Invalid action-forwarding webhook secret');
    }

    return this.forwarding.handleInboundDeliveryEvent(payload);
  }
}
