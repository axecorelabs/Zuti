import { Injectable, Logger } from '@nestjs/common';
import { Prisma, IdentifierType, CustomerLifecycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A single identifier observed for a person. `isAnchor` = a channel of contact they demonstrably
 *  control (safe to auto-attach/merge on); non-anchor = a typed attribute (contact data only). */
export interface IdentifierInput {
  type: IdentifierType;
  value: string;
  isAnchor: boolean;
  source?: string;
}

/** The conversation fields the hub reads to resolve a person (a subset of Prisma's Conversation). */
export interface ConversationIdentity {
  id: string;
  organizationId: string;
  channel: string;
  telegramChatId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  whatsappUserId?: string | null;
  whatsappPhoneNumber?: string | null;
  whatsappProfileName?: string | null;
  widgetVisitorId?: string | null;
  widgetVisitorEmail?: string | null;
  createdAt?: Date | null;
  lastMessageAt?: Date | null;
}

/** Non-identity facts that enrich the profile (never used for matching). */
export interface CustomerHints {
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Advance the lifecycle to at least this stage (e.g. a purchase → CUSTOMER). */
  minLifecycle?: CustomerLifecycle;
  /** Timestamp of the interaction (defaults to now) — used for firstSeen/lastSeen. */
  seenAt?: Date;
}

const LIFECYCLE_RANK: Record<CustomerLifecycle, number> = { LEAD: 0, ENGAGED: 1, CUSTOMER: 2 };

/**
 * The identity spine of the Customer hub. Resolves a set of observed identifiers to a single
 * Customer per org — creating one when unseen, attaching to one when an anchor matches, and merging
 * when anchors point at several. Typed attributes are recorded but NEVER drive an automatic merge,
 * and matching is deterministic only (no fuzzy/name matching) so we under-merge rather than ever
 * leak one person's data into another's. See CUSTOMER_HUB_PLAN.md.
 */
@Injectable()
export class CustomerIdentityService {
  private readonly logger = new Logger(CustomerIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extract the identity signals from a conversation: the channel-of-contact anchor (Telegram chat,
   * WhatsApp phone, sender email, widget session) plus any typed email as a non-anchor attribute.
   * Shared by the live ingest wiring and the backfill so the two never drift.
   */
  identifiersForConversation(c: ConversationIdentity): IdentifierInput[] {
    const ids: IdentifierInput[] = [];
    if (c.channel === 'TELEGRAM' && c.telegramChatId) ids.push({ type: 'TELEGRAM_CHAT', value: c.telegramChatId, isAnchor: true, source: 'conversation' });
    if (c.channel === 'WHATSAPP') {
      const wa = c.whatsappPhoneNumber || c.whatsappUserId;
      if (wa) ids.push({ type: 'WHATSAPP_PHONE', value: wa, isAnchor: true, source: 'conversation' });
    }
    if (c.channel === 'EMAIL' && c.customerEmail) ids.push({ type: 'EMAIL', value: c.customerEmail, isAnchor: true, source: 'conversation' });
    if (c.channel === 'WIDGET') {
      if (c.widgetVisitorId) ids.push({ type: 'WIDGET_SESSION', value: c.widgetVisitorId, isAnchor: true, source: 'conversation' });
      if (c.widgetVisitorEmail) ids.push({ type: 'EMAIL', value: c.widgetVisitorEmail, isAnchor: false, source: 'widget-typed' });
    }
    if (c.customerEmail && !ids.some((i) => i.type === 'EMAIL')) {
      ids.push({ type: 'EMAIL', value: c.customerEmail, isAnchor: c.channel === 'EMAIL', source: 'conversation' });
    }
    return ids;
  }

  /**
   * Live ingest hook: resolve the conversation's person and stamp `customerId` on it. Call this
   * fire-and-forget from the channel processors when a NEW conversation is created — it's off the
   * reply path, and a failure must never affect message handling. Returns the customerId (or null if
   * the conversation carries no anchor to resolve on).
   */
  async linkConversation(c: ConversationIdentity): Promise<string | null> {
    const ids = this.identifiersForConversation(c);
    if (ids.length === 0) return null;
    const customerId = await this.resolve(c.organizationId, ids, {
      displayName: c.customerName || c.whatsappProfileName || null,
      email: c.customerEmail || c.widgetVisitorEmail || null,
      phone: c.whatsappPhoneNumber || null,
      minLifecycle: 'LEAD',
      seenAt: c.lastMessageAt || c.createdAt || new Date(),
    });
    await this.prisma.conversation.update({ where: { id: c.id }, data: { customerId } });
    return customerId;
  }

  /**
   * Build the NEED-TO-KNOW customer slice the agent reads at the start of a conversation (Stage 2
   * read loop). Ensures the person is resolved first (so the AI actually sees them), then returns a
   * compact, deliberately-lean block — name, relationship, tags, short notes — NOT the full profile,
   * raw identifiers, or history. Per-org by construction. Returns null when there's nothing worth
   * surfacing (a brand-new lead with no CRM data), to avoid noising up the prompt.
   */
  async getAgentContextBlock(conv: ConversationIdentity & { customerId?: string | null }): Promise<string | null> {
    let customerId = conv.customerId ?? null;
    // The caller's object may predate the (fire-and-forget) ingest link — a cheap read catches the
    // already-linked case so returning customers never trigger a full resolve here.
    if (!customerId && conv.id) {
      const fresh = await this.prisma.conversation.findUnique({ where: { id: conv.id }, select: { customerId: true } });
      customerId = fresh?.customerId ?? null;
    }
    if (!customerId) customerId = await this.linkConversation(conv); // truly new → resolve before the AI reads
    if (!customerId) return null;

    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        displayName: true, primaryEmail: true, lifecycleStage: true, tags: true, notes: true, firstSeenAt: true,
        _count: { select: { conversations: true, salesOrders: true, commerceOrders: true, registrationEntries: true, bookings: true } },
      },
    });
    if (!c) return null;

    const priorConversations = Math.max(0, (c._count?.conversations ?? 1) - 1); // exclude the current thread
    const orders = (c._count?.salesOrders ?? 0) + (c._count?.commerceOrders ?? 0);
    const registrations = c._count?.registrationEntries ?? 0;
    const bookings = c._count?.bookings ?? 0;
    const hasActivity = orders > 0 || registrations > 0 || bookings > 0;
    const returning = priorConversations > 0;
    const hasCrm = (c.tags?.length ?? 0) > 0 || !!c.notes || c.lifecycleStage !== 'LEAD';
    if (!returning && !hasCrm && !hasActivity) return null; // nothing useful yet → no block

    const lines = ['KNOWN CUSTOMER — background context to personalize your tone (you may greet them by name). It is NOT a source of action details: for any registration, order, or booking you MUST still get the customer to provide or confirm their name, email, and required fields IN THIS conversation. Never assume, infer, construct, invent, or reuse a profile value they did not give you here. Do not read this profile out verbatim or claim you looked them up.'];
    lines.push(`- Name: ${c.displayName ?? 'unknown'}${c.primaryEmail ? ` (${c.primaryEmail})` : ''}`);
    lines.push(`- Relationship: ${c.lifecycleStage.toLowerCase()}${returning ? ` · ${priorConversations} prior conversation${priorConversations === 1 ? '' : 's'}` : ''} · first seen ${c.firstSeenAt.toISOString().slice(0, 10)}`);
    if (hasActivity) {
      const parts: string[] = [];
      if (orders) parts.push(`${orders} order${orders === 1 ? '' : 's'}`);
      if (registrations) parts.push(`${registrations} event registration${registrations === 1 ? '' : 's'}`);
      if (bookings) parts.push(`${bookings} booking${bookings === 1 ? '' : 's'}`);
      lines.push(`- History: ${parts.join(', ')}`);
    }
    if (c.tags?.length) lines.push(`- Tags: ${c.tags.join(', ')}`);
    if (c.notes) lines.push(`- Notes: ${c.notes.slice(0, 400)}`);
    return lines.join('\n');
  }

  /** Normalize a value so the same real identifier always maps to the same row. */
  normalize(type: IdentifierType, value: string): string {
    const v = (value ?? '').trim();
    if (type === 'EMAIL') return v.toLowerCase();
    if (type === 'WHATSAPP_PHONE' || type === 'PHONE') {
      const digits = v.replace(/[^\d+]/g, '');
      return digits.startsWith('+') ? '+' + digits.slice(1).replace(/\D/g, '') : digits.replace(/\D/g, '');
    }
    return v; // chat/user/session ids kept as-is
  }

  /**
   * Resolve (or create) the Customer for a set of identifiers within an org and return its id.
   * Anchors drive lookup + merge; non-anchor attributes are attached only if their value isn't
   * already owned by someone else (never merges, never conflicts).
   */
  async resolve(orgId: string, identifiers: IdentifierInput[], hints: CustomerHints = {}): Promise<string> {
    const norm = identifiers
      .map((i) => ({ ...i, value: this.normalize(i.type, i.value) }))
      .filter((i) => i.value.length > 0);
    if (norm.length === 0) throw new Error('resolve() requires at least one non-empty identifier');

    const seenAt = hints.seenAt ?? new Date();
    const key = (t: IdentifierType, v: string) => `${t} ${v}`;
    const anchorKeys = new Set(norm.filter((i) => i.isAnchor).map((i) => key(i.type, i.value)));

    // Batched to keep the interactive transaction short (the DB is remote): one lookup, one createMany.
    return this.prisma.$transaction(
      async (tx) => {
        // 1. One lookup covering every identifier we've observed.
        const existing = await tx.customerIdentifier.findMany({
          where: { orgId, OR: norm.map((i) => ({ type: i.type, value: i.value })) },
          select: { type: true, value: true, customerId: true, isAnchor: true },
        });
        const existingByKey = new Map(existing.map((e) => [key(e.type, e.value), e]));

        // 2. Which existing customers do OUR ANCHORS point at? (attributes never match for merge)
        const matched = [...new Set(existing.filter((e) => anchorKeys.has(key(e.type, e.value))).map((e) => e.customerId))];

        let customerId: string;
        if (matched.length === 0) {
          const created = await tx.customer.create({
            data: {
              orgId,
              displayName: hints.displayName?.trim() || null,
              primaryEmail: hints.email?.toLowerCase().trim() || null,
              primaryPhone: hints.phone?.trim() || null,
              lifecycleStage: hints.minLifecycle ?? 'LEAD',
              firstSeenAt: seenAt,
              lastSeenAt: seenAt,
            },
            select: { id: true },
          });
          customerId = created.id;
        } else {
          // Oldest is the survivor; merge any others into it (anchors pointed at several people).
          const survivors = await tx.customer.findMany({
            where: { id: { in: matched } },
            orderBy: { firstSeenAt: 'asc' },
            select: { id: true },
          });
          customerId = survivors[0].id;
          for (const other of survivors.slice(1)) await this.mergeWithinTx(tx, orgId, customerId, other.id);
          await this.enrichWithinTx(tx, customerId, hints, seenAt);
        }

        // 3. Attach missing identifiers in one createMany; upgrade attribute→anchor where we now know better.
        const toCreate: Prisma.CustomerIdentifierCreateManyInput[] = [];
        for (const i of norm) {
          const ex = existingByKey.get(key(i.type, i.value));
          if (!ex) {
            toCreate.push({ orgId, customerId, type: i.type, value: i.value, isAnchor: i.isAnchor, source: i.source ?? null });
          } else if (ex.customerId === customerId && i.isAnchor && !ex.isAnchor) {
            await tx.customerIdentifier.update({
              where: { orgId_type_value: { orgId, type: i.type, value: i.value } },
              data: { isAnchor: true },
            });
          }
          // A value already owned by a DIFFERENT customer as a typed attribute is left where it is.
        }
        if (toCreate.length) await tx.customerIdentifier.createMany({ data: toCreate, skipDuplicates: true });

        return customerId;
      },
      { timeout: 20000, maxWait: 10000 },
    );
  }

  /**
   * Resolve the Customer for a transaction (order / booking / registration) so it shows on their
   * profile. Prefers the originating conversation's already-resolved person (a real anchor); falls
   * back to the buyer's own email as an anchor-by-necessity — but ONLY for single-buyer transactions
   * (`allowEmailAnchor`), never for registration attendees (a typed attendee email isn't the buyer).
   * A transaction is proof of a real relationship, so the customer is promoted to CUSTOMER.
   */
  async resolveForTransaction(orgId: string, opts: {
    conversationId?: string | null; email?: string | null; name?: string | null; phone?: string | null;
    seenAt?: Date; allowEmailAnchor?: boolean;
  }): Promise<string | null> {
    if (opts.conversationId) {
      const conv = await this.prisma.conversation.findFirst({ where: { id: opts.conversationId, organizationId: orgId }, select: { customerId: true } });
      if (conv?.customerId) {
        await this.prisma.customer.update({
          where: { id: conv.customerId },
          data: { lifecycleStage: 'CUSTOMER', lastSeenAt: opts.seenAt ?? new Date() },
        }).catch(() => null);
        return conv.customerId;
      }
    }
    if (opts.allowEmailAnchor && opts.email) {
      const ids: IdentifierInput[] = [{ type: 'EMAIL', value: opts.email, isAnchor: true, source: 'transaction' }];
      if (opts.phone) ids.push({ type: 'PHONE', value: opts.phone, isAnchor: false, source: 'transaction' });
      return this.resolve(orgId, ids, { displayName: opts.name, email: opts.email, phone: opts.phone, minLifecycle: 'CUSTOMER', seenAt: opts.seenAt });
    }
    return null;
  }

  /** Merge `absorbedId` into `survivorId`: repoint everything, union attributes, delete the absorbed. */
  async merge(orgId: string, survivorId: string, absorbedId: string): Promise<void> {
    if (survivorId === absorbedId) return;
    await this.prisma.$transaction((tx) => this.mergeWithinTx(tx, orgId, survivorId, absorbedId));
  }

  private async mergeWithinTx(tx: Prisma.TransactionClient, orgId: string, survivorId: string, absorbedId: string) {
    if (survivorId === absorbedId) return;
    const [survivor, absorbed] = await Promise.all([
      tx.customer.findUnique({ where: { id: survivorId } }),
      tx.customer.findUnique({ where: { id: absorbedId } }),
    ]);
    if (!survivor || !absorbed || survivor.orgId !== orgId || absorbed.orgId !== orgId) return;

    // Identifier values are unique per (org,type,value), so the two sets never collide — safe repoint.
    await tx.customerIdentifier.updateMany({ where: { customerId: absorbedId }, data: { customerId: survivorId } });
    await tx.conversation.updateMany({ where: { customerId: absorbedId }, data: { customerId: survivorId } });

    await tx.customer.update({
      where: { id: survivorId },
      data: {
        displayName: survivor.displayName ?? absorbed.displayName,
        primaryEmail: survivor.primaryEmail ?? absorbed.primaryEmail,
        primaryPhone: survivor.primaryPhone ?? absorbed.primaryPhone,
        notes: [survivor.notes, absorbed.notes].filter(Boolean).join('\n') || null,
        tags: [...new Set([...survivor.tags, ...absorbed.tags])],
        lifecycleStage: LIFECYCLE_RANK[absorbed.lifecycleStage] > LIFECYCLE_RANK[survivor.lifecycleStage] ? absorbed.lifecycleStage : survivor.lifecycleStage,
        emailOptOut: survivor.emailOptOut || absorbed.emailOptOut,
        marketingConsentAt: survivor.marketingConsentAt ?? absorbed.marketingConsentAt,
        firstSeenAt: survivor.firstSeenAt < absorbed.firstSeenAt ? survivor.firstSeenAt : absorbed.firstSeenAt,
        lastSeenAt: survivor.lastSeenAt > absorbed.lastSeenAt ? survivor.lastSeenAt : absorbed.lastSeenAt,
      },
    });
    await tx.customer.delete({ where: { id: absorbedId } });
    this.logger.log(`Merged customer ${absorbedId} into ${survivorId} (org ${orgId})`);
  }

  /** Fill empty identity fields, advance lifecycle, and bump first/last seen — never overwrites. */
  private async enrichWithinTx(tx: Prisma.TransactionClient, customerId: string, hints: CustomerHints, seenAt: Date) {
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    if (!c) return;
    const data: Prisma.CustomerUpdateInput = {};
    if (!c.displayName && hints.displayName?.trim()) data.displayName = hints.displayName.trim();
    if (!c.primaryEmail && hints.email?.trim()) data.primaryEmail = hints.email.toLowerCase().trim();
    if (!c.primaryPhone && hints.phone?.trim()) data.primaryPhone = hints.phone.trim();
    if (hints.minLifecycle && LIFECYCLE_RANK[hints.minLifecycle] > LIFECYCLE_RANK[c.lifecycleStage]) data.lifecycleStage = hints.minLifecycle;
    if (seenAt < c.firstSeenAt) data.firstSeenAt = seenAt;
    if (seenAt > c.lastSeenAt) data.lastSeenAt = seenAt;
    if (Object.keys(data).length) await tx.customer.update({ where: { id: customerId }, data });
  }
}
