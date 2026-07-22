import { Controller, Post, Body, Headers, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RegistrationsService } from './registrations.service';

interface RegisterToolBody {
  orgId: string;
  botId?: string;
  conversationId?: string;
  productId: string;
  quantity?: number;
  customerName?: string;
  customerEmail?: string;
  fields?: Record<string, string>;
}

/**
 * Internal tool-execution endpoint. The AI agent loop (Python service) calls this to run the
 * `register_for_event` tool and gets back a real, structured result to compose its reply from.
 * Authenticated by the shared internal secret — same trust boundary the backend uses to call
 * the AI service, just in the reverse direction.
 */
@ApiExcludeController()
@Public()
@Controller('internal/registration')
export class InternalRegistrationController {
  constructor(
    private readonly svc: RegistrationsService,
    private readonly config: ConfigService,
  ) {}

  private assertInternal(key: string | undefined) {
    const secret = (this.config.get<string>('INTERNAL_API_SECRET') ?? this.config.get<string>('AI_SERVICE_SECRET') ?? '').trim();
    if (!secret || !key) throw new ForbiddenException('Unauthorized');
    const a = createHash('sha256').update(secret).digest();
    const b = createHash('sha256').update(key).digest();
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Unauthorized');
  }

  @Post('register-for-event')
  @HttpCode(HttpStatus.OK)
  async registerForEvent(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Body() body: RegisterToolBody,
  ) {
    this.assertInternal(internalKey);
    if (!body?.orgId || !body?.productId) {
      return { outcome: 'PRODUCT_NOT_FOUND', message: 'Missing organization or product id.' };
    }
    return this.svc.executeRegistrationTool({
      orgId: body.orgId,
      botId: body.botId,
      conversationId: body.conversationId,
      productId: body.productId,
      quantity: body.quantity,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      fields: body.fields,
    });
  }
}
