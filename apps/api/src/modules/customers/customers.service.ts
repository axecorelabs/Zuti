import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CustomerLifecycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerIdentityService } from './customer-identity.service';
import { UpdateCustomerDto } from './dto/customers.dto';

/**
 * Read/manage the Customer hub for the dashboard. Identity resolution itself lives in
 * CustomerIdentityService; this owns list, profile (with activity timeline), the writeable CRM layer
 * (tags/notes/consent/lifecycle), plus compliance actions (export, erase) and manual merge.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: CustomerIdentityService,
  ) {}

  /** Paginated, searchable list. Defaults to hiding raw `LEAD`s unless includeLeads/stage says otherwise. */
  async list(orgId: string, opts: { search?: string; stage?: CustomerLifecycle; includeLeads?: boolean; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const search = opts.search?.trim();

    const where: Prisma.CustomerWhereInput = { orgId };
    if (opts.stage) where.lifecycleStage = opts.stage;
    else if (!opts.includeLeads && !search) where.lifecycleStage = { in: ['ENGAGED', 'CUSTOMER'] };
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { primaryEmail: { contains: search, mode: 'insensitive' } },
        { primaryPhone: { contains: search, mode: 'insensitive' } },
        { identifiers: { some: { value: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, displayName: true, primaryEmail: true, primaryPhone: true, lifecycleStage: true,
          tags: true, emailOptOut: true, firstSeenAt: true, lastSeenAt: true,
          identifiers: { select: { type: true, isAnchor: true }, take: 8 },
          _count: { select: { conversations: true } },
        },
      }),
    ]);
    return { items, total, limit, offset };
  }

  /** One customer's full profile + activity timeline (Stage 1: conversations). */
  async getProfile(orgId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, orgId },
      include: {
        identifiers: { orderBy: [{ isAnchor: 'desc' }, { createdAt: 'asc' }] },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 50,
          select: { id: true, channel: true, status: true, lastMessageAt: true, createdAt: true, botId: true },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Writeable CRM layer + rectification. Identity anchors are managed via resolution/merge, not here. */
  async update(orgId: string, customerId: string, dto: UpdateCustomerDto) {
    await this.assertCustomer(orgId, customerId);
    const data: Prisma.CustomerUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName?.trim() || null;
    if (dto.primaryEmail !== undefined) data.primaryEmail = dto.primaryEmail?.toLowerCase().trim() || null;
    if (dto.primaryPhone !== undefined) data.primaryPhone = dto.primaryPhone?.trim() || null;
    if (dto.lifecycleStage !== undefined) data.lifecycleStage = dto.lifecycleStage;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    if (dto.emailOptOut !== undefined) data.emailOptOut = dto.emailOptOut;
    if (dto.marketingConsent !== undefined) data.marketingConsentAt = dto.marketingConsent ? new Date() : null;
    return this.prisma.customer.update({ where: { id: customerId }, data });
  }

  /** Manual merge of a suspected-duplicate into a survivor. */
  async merge(orgId: string, survivorId: string, absorbedId: string) {
    await Promise.all([this.assertCustomer(orgId, survivorId), this.assertCustomer(orgId, absorbedId)]);
    await this.identity.merge(orgId, survivorId, absorbedId);
    return { ok: true, survivorId };
  }

  /** Right of access / portability: a full JSON dump of everything we hold for this person. */
  async export(orgId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, orgId },
      include: {
        identifiers: true,
        conversations: {
          select: { id: true, channel: true, status: true, createdAt: true, lastMessageAt: true,
            messages: { select: { role: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return { exportedAt: new Date().toISOString(), customer };
  }

  /** Right to erasure. Cascades identifiers; conversations keep their history with customerId nulled. */
  async remove(orgId: string, customerId: string) {
    await this.assertCustomer(orgId, customerId);
    await this.prisma.customer.delete({ where: { id: customerId } });
    return { ok: true };
  }

  private async assertCustomer(orgId: string, customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, orgId }, select: { id: true } });
    if (!c) throw new NotFoundException('Customer not found');
  }

  /**
   * AI write loop (Stage 2B). The agent calls this to enrich the CURRENT conversation's customer with
   * durable facts it learned. This is the **server-side gate**: only ENRICHMENT fields exist here —
   * note (append), tags (union), name (fill-if-empty). Protected fields (contact details, consent,
   * identity anchors, merge) are structurally absent, so a hallucinating or prompt-injected model
   * cannot touch them, and it can never overwrite a known name or set an anchor. Scoped to the
   * conversation's own customer, so it can't write to anyone else.
   */
  async enrichFromAgent(orgId: string, conversationId: string, input: { note?: string; tags?: string[]; name?: string }): Promise<{ ok: boolean; reason?: string }> {
    if (!conversationId) return { ok: false, reason: 'no_conversation' };
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, organizationId: orgId }, select: { customerId: true } });
    if (!conv?.customerId) return { ok: false, reason: 'no_customer' };
    const c = await this.prisma.customer.findUnique({
      where: { id: conv.customerId },
      select: { displayName: true, tags: true, notes: true, lifecycleStage: true },
    });
    if (!c) return { ok: false, reason: 'not_found' };

    const data: Prisma.CustomerUpdateInput = {};
    // Name: fill only when unknown — never overwrite (identity is not the AI's to rewrite).
    if (input.name?.trim() && !c.displayName) data.displayName = input.name.trim().slice(0, 120);
    // Tags: union, normalized + capped. Additive only (AI can't remove tags a human set).
    if (Array.isArray(input.tags) && input.tags.length) {
      const add = input.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10);
      const merged = [...new Set([...c.tags, ...add])].slice(0, 30);
      if (merged.length !== c.tags.length) data.tags = merged;
    }
    // Note: append (dated), never overwrite; keep the record bounded.
    if (input.note?.trim()) {
      const line = `[${new Date().toISOString().slice(0, 10)}] ${input.note.trim().slice(0, 500)}`;
      data.notes = [c.notes, line].filter(Boolean).join('\n').slice(-4000);
    }
    // Actively conversing + learning is an engagement signal: bump LEAD→ENGAGED only. Never CUSTOMER
    // (that must come from a real transaction), never a downgrade.
    if (c.lifecycleStage === 'LEAD') data.lifecycleStage = 'ENGAGED';

    if (Object.keys(data).length === 0) return { ok: true };
    await this.prisma.customer.update({ where: { id: conv.customerId }, data });
    return { ok: true };
  }
}
