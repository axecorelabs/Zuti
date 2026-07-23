import { Controller, Post, Body, Headers, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface SetSummaryBody {
  conversationId: string;
  orgId?: string;
  summary: string;
}

/**
 * Internal ingress for the AI service. The running conversation summary is refreshed OFF the reply's
 * critical path (the model call for it no longer blocks the customer's response) — the AI service
 * computes it in the background and posts it here to persist. Stored on
 * conversation.metadata.conversationSummary, the same field the channel processors read as
 * next-turn context. Authenticated by the shared internal secret.
 */
@ApiExcludeController()
@Public()
@Controller('internal/conversations')
export class InternalConversationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private assertInternal(key: string | undefined) {
    const secret = (this.config.get<string>('INTERNAL_API_SECRET') ?? this.config.get<string>('AI_SERVICE_SECRET') ?? '').trim();
    if (!secret || !key) throw new ForbiddenException('Unauthorized');
    const a = createHash('sha256').update(secret).digest();
    const b = createHash('sha256').update(key).digest();
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Unauthorized');
  }

  @Post('summary')
  @HttpCode(HttpStatus.OK)
  async setSummary(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Body() body: SetSummaryBody,
  ) {
    this.assertInternal(internalKey);
    const conversationId = (body?.conversationId ?? '').trim();
    const summary = (body?.summary ?? '').trim();
    if (!conversationId || !summary) return { ok: false };

    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, metadata: true },
    });
    if (!convo) return { ok: false };

    const meta = (convo.metadata && typeof convo.metadata === 'object' ? convo.metadata : {}) as Record<string, unknown>;
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: { ...meta, conversationSummary: summary } as Prisma.InputJsonValue },
    });
    return { ok: true };
  }
}
