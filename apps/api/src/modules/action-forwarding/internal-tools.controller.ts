import { Controller, Post, Body, Headers, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ActionForwardingService } from './action-forwarding.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { TeamChatService } from '../team-chat/team-chat.service';
import { CommerceService } from '../commerce/commerce.service';
import { CustomersService } from '../customers/customers.service';
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
    private readonly teamChat: TeamChatService,
    private readonly commerce: CommerceService,
    private readonly customers: CustomersService,
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
      // Cart path: `tickets` is an array of per-attendee tickets (multi-tier / multi-person, one
      // payment). Each element becomes its own ticket with its own QR.
      if (Array.isArray(args.tickets) && args.tickets.length > 0) {
        const tickets = (args.tickets as unknown[])
          .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
          .map((t) => ({
            ticketTypeId: typeof t.ticket_type_id === 'string' ? t.ticket_type_id : undefined,
            ticketTypeName: typeof t.ticket_type_name === 'string' ? t.ticket_type_name : undefined,
            name: typeof t.name === 'string' ? t.name : undefined,
            email: typeof t.email === 'string' ? t.email : undefined,
            fields: t.fields && typeof t.fields === 'object' ? (t.fields as Record<string, string>) : undefined,
          }));
        return this.registrations.executeRegistrationCartTool({
          orgId: body.orgId,
          botId: body.botId,
          conversationId: body.conversationId,
          productId,
          customerName: typeof args.customer_name === 'string' ? args.customer_name : undefined,
          customerEmail: typeof args.customer_email === 'string' ? args.customer_email : undefined,
          tickets,
        });
      }
      return this.registrations.executeRegistrationTool({
        orgId: body.orgId,
        botId: body.botId,
        conversationId: body.conversationId,
        productId,
        ticketTypeId: String(args.ticket_type_id ?? '').trim() || undefined,
        ticketTypeName: String(args.ticket_type_name ?? '').trim() || undefined,
        quantity: typeof args.quantity === 'number' ? args.quantity : Number(args.quantity) || 1,
        customerName: typeof args.customer_name === 'string' ? args.customer_name : undefined,
        customerEmail: typeof args.customer_email === 'string' ? args.customer_email : undefined,
        fields: args.fields && typeof args.fields === 'object' ? (args.fields as Record<string, string>) : undefined,
      });
    }

    // Customer hub write loop: the agent records durable facts about THIS conversation's customer.
    // Server-gated to enrichment fields only (note/tags/name-if-empty); contact details, consent,
    // identity anchors, and merge are structurally unreachable from here.
    if (toolName === 'remember_about_customer') {
      if (!body.conversationId) return { outcome: 'ERROR', message: 'No conversation context.' };
      try {
        const res = await this.customers.enrichFromAgent(body.orgId, body.conversationId, {
          note: typeof args.note === 'string' ? args.note : undefined,
          tags: Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === 'string') : undefined,
          name: typeof args.name === 'string' ? args.name : undefined,
        });
        return res.ok
          ? { outcome: 'SAVED', message: "Noted on the customer's profile." }
          : { outcome: 'SKIPPED', message: 'Nothing was saved (no customer resolved for this conversation).' };
      } catch {
        return { outcome: 'ERROR', message: 'Could not update the customer profile.' };
      }
    }

    // Product search: return the bot's store catalog (products, variant_ids, prices, stock) for the
    // AI to quote from and order against — pricing stays authoritative (backend-owned).
    if (toolName === 'search_products') {
      const query = typeof args.query === 'string' ? args.query : '';
      try {
        return await this.commerce.searchProductsForBot(body.orgId, body.botId, query);
      } catch {
        return { outcome: 'ERROR', message: 'Could not search the catalog right now.', products: [] };
      }
    }

    // Knowledge-gap logging: the AI flags a genuine question the knowledge base couldn't answer.
    // Populates the Gaps tab (deduped by topic) without escalating or handing off to a human.
    if (toolName === 'report_knowledge_gap') {
      const question = String(args.question ?? '').trim();
      if (!question) return { outcome: 'ERROR', message: 'Missing question.' };
      try {
        const res = await this.teamChat.recordKnowledgeGap(body.orgId, {
          question,
          topic: typeof args.topic === 'string' ? args.topic : null,
          conversationId: body.conversationId ?? null,
          metadata: { source: 'ai_knowledge_tool', channel },
        });
        return { outcome: 'LOGGED', message: res.created ? 'Knowledge gap recorded for the team.' : 'Knowledge gap already tracked (count incremented).' };
      } catch {
        return { outcome: 'ERROR', message: 'Could not record the knowledge gap.' };
      }
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
