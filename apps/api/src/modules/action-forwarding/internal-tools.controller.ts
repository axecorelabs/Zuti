import { Controller, Post, Body, Headers, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ActionForwardingService } from './action-forwarding.service';
import { RegistrationsService } from '../registrations/registrations.service';
import type { RuntimeChannel } from './action-forwarding.types';

interface ExecuteToolBody {
  toolName: string;
  orgId: string;
  botId?: string;
  conversationId?: string;
  channel?: string;
  args?: Record<string, unknown>;
}

const VALID_CHANNELS: RuntimeChannel[] = ['WIDGET', 'EMAIL', 'TELEGRAM', 'WHATSAPP'];

/**
 * Unified internal tool-execution endpoint. The AI agent loop (Python service) posts every tool
 * call here and receives a real, structured result to compose its reply from. Registration is
 * dispatched to RegistrationsService (it owns payment/tickets); all other action tools go through
 * ActionForwardingService, which reuses the same record-creation + delivery path as classic
 * forwarding. Authenticated by the shared internal secret.
 */
@ApiExcludeController()
@Public()
@Controller('internal/tools')
export class InternalToolsController {
  constructor(
    private readonly actionForwarding: ActionForwardingService,
    private readonly registrations: RegistrationsService,
    private readonly config: ConfigService,
  ) {}

  private assertInternal(key: string | undefined) {
    const secret = (this.config.get<string>('INTERNAL_API_SECRET') ?? this.config.get<string>('AI_SERVICE_SECRET') ?? '').trim();
    if (!secret || !key) throw new ForbiddenException('Unauthorized');
    const a = createHash('sha256').update(secret).digest();
    const b = createHash('sha256').update(key).digest();
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Unauthorized');
  }

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async execute(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Body() body: ExecuteToolBody,
  ) {
    this.assertInternal(internalKey);

    const toolName = (body?.toolName ?? '').trim();
    if (!toolName || !body?.orgId) {
      return { outcome: 'ERROR', message: 'Missing tool name or organization id.' };
    }

    const channel = VALID_CHANNELS.includes(body.channel as RuntimeChannel)
      ? (body.channel as RuntimeChannel)
      : 'TELEGRAM';
    const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>;

    // Registration keeps its dedicated executor (capacity, dedup, Paystack, ticket/receipt).
    if (toolName === 'register_for_event') {
      const productId = String(args.product_id ?? '').trim();
      if (!productId) {
        return { outcome: 'PRODUCT_NOT_FOUND', message: 'Missing product id.' };
      }
      return this.registrations.executeRegistrationTool({
        orgId: body.orgId,
        botId: body.botId,
        conversationId: body.conversationId,
        productId,
        quantity: typeof args.quantity === 'number' ? args.quantity : Number(args.quantity) || 1,
        customerName: typeof args.customer_name === 'string' ? args.customer_name : undefined,
        customerEmail: typeof args.customer_email === 'string' ? args.customer_email : undefined,
        fields: args.fields && typeof args.fields === 'object' ? (args.fields as Record<string, string>) : undefined,
      });
    }

    if (!body.conversationId) {
      return { outcome: 'ERROR', message: 'Missing conversation id.' };
    }

    return this.actionForwarding.executeActionTool({
      toolName,
      orgId: body.orgId,
      botId: body.botId ?? '',
      conversationId: body.conversationId,
      channel,
      args,
    });
  }
}
