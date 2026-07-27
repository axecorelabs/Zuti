import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { CustomerIdentityService } from '../customers/customer-identity.service';
import { RECEIPTS_QUEUE } from '../queue/queue.module';
import { RECEIPT_JOB, RECEIPT_JOB_OPTIONS } from '../queue/receipts.processor';
import { CreateRegistrationProductDto, UpdateRegistrationProductDto, UpdateRegistrationEntryDto, CreateTicketTypeDto, UpdateTicketTypeDto, PublicRegisterDto, PublicCartDto } from './dto/registrations.dto';

type PaystackInitResponse = {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
};

export type RegistrationProductField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
};

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly events: EventsGateway,
    private readonly customerIdentity: CustomerIdentityService,
    @InjectQueue(RECEIPTS_QUEUE) private readonly receiptsQueue: Queue,
  ) {}

  /** Fire-and-forget: link created registration entries to the buyer's Customer (conversation-anchored;
   *  attendee-safe — never resolves a customer from an attendee's typed email). */
  private linkEntriesToCustomer(orgId: string, entryIds: string[], conversationId?: string | null) {
    if (!conversationId || entryIds.length === 0) return;
    this.customerIdentity
      .resolveForTransaction(orgId, { conversationId, allowEmailAnchor: false, seenAt: new Date() })
      .then((cid) => (cid ? this.prisma.registrationEntry.updateMany({ where: { id: { in: entryIds } }, data: { customerId: cid } }) : null))
      .catch(() => null);
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async createProduct(orgId: string, dto: CreateRegistrationProductDto) {
    if (dto.botId) {
      const bot = await this.prisma.bot.findFirst({ where: { id: dto.botId, organizationId: orgId }, select: { id: true } });
      if (!bot) throw new NotFoundException('Bot not found');
    }
    // Gate: a paid event can't go public until the org can actually receive the money.
    const createPaid = (!dto.isFree && (dto.priceMinor ?? 0) > 0) || (dto.ticketTypes?.some((t) => (t.priceMinor ?? 0) > 0) ?? false);
    if (dto.isPublic && createPaid && !(await this.orgHasPayout(orgId))) {
      throw new ForbiddenException(this.PAYOUT_GATE_MSG);
    }
    // A public event needs a shareable slug; generate one from the name if none was supplied.
    const slug = dto.slug?.trim()
      ? await this.ensureUniqueSlug(this.slugifyBase(dto.slug))
      : (dto.isPublic ? await this.ensureUniqueSlug(this.slugifyBase(dto.name)) : null);
    return this.prisma.registrationProduct.create({
      data: {
        orgId,
        botId: dto.botId ?? null,
        name: dto.name,
        description: dto.description ?? null,
        eventDate: dto.eventDate ? new Date(dto.eventDate) : null,
        capacity: dto.capacity ?? null,
        isFree: dto.isFree,
        priceMinor: dto.isFree ? null : (dto.priceMinor ?? null),
        currency: dto.currency ?? 'NGN',
        requiresApproval: dto.requiresApproval,
        allowDuplicateRegistrations: dto.allowDuplicateRegistrations ?? false,
        confirmationMessage: dto.confirmationMessage ?? null,
        fields: (dto.fields ?? []) as any,
        isActive: dto.isActive ?? true,
        isPublic: dto.isPublic ?? false,
        slug,
        bannerUrl: dto.bannerUrl ?? null,
        flierUrl: dto.flierUrl ?? null,
        venue: dto.venue ?? null,
        // Create any tiers in the same transaction so an event is never left half-configured.
        ...(dto.ticketTypes && dto.ticketTypes.length > 0
          ? {
              ticketTypes: {
                create: dto.ticketTypes.map((t, i) => ({
                  name: t.name,
                  description: t.description ?? null,
                  priceMinor: t.priceMinor ?? null,
                  currency: t.currency ?? dto.currency ?? 'NGN',
                  capacity: t.capacity ?? null,
                  sortOrder: t.sortOrder ?? i,
                })),
              },
            }
          : {}),
      },
      include: { ticketTypes: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
  }

  // ── Public-page slug helpers ────────────────────────────────────────────────
  private slugifyBase(value: string): string {
    return (value || 'event')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'event';
  }

  /** Global-unique slug: try the base, then append a short random suffix on collision. */
  private async ensureUniqueSlug(base: string, ignoreProductId?: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
      const existing = await this.prisma.registrationProduct.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!existing || existing.id === ignoreProductId) return candidate;
    }
    return `${base}-${randomBytes(6).toString('hex')}`;
  }

  async listProducts(orgId: string, botId?: string) {
    const products = await this.prisma.registrationProduct.findMany({
      where: { orgId, ...(botId ? { botId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
    // Attach usedSpots (SUM of ticket quantities across non-cancelled entries) for capacity display.
    return Promise.all(products.map(async (p) => ({
      ...p,
      usedSpots: await this.getUsedSpots(p.id),
    })));
  }

  async getProduct(orgId: string, productId: string) {
    const product = await this.prisma.registrationProduct.findFirst({
      where: { id: productId, orgId },
      include: { _count: { select: { entries: true } } },
    });
    if (!product) throw new NotFoundException('Registration product not found');
    return { ...product, usedSpots: await this.getUsedSpots(product.id) };
  }

  async updateProduct(orgId: string, productId: string, dto: UpdateRegistrationProductDto) {
    const existing = await this.prisma.registrationProduct.findFirst({ where: { id: productId, orgId } });
    if (!existing) throw new NotFoundException('Registration product not found');
    // Gate: publishing a PAID event (single price or any paid tier) requires a connected payout account.
    if (dto.isPublic === true && !existing.isPublic) {
      const willBeFree = dto.isFree ?? existing.isFree;
      const price = dto.priceMinor ?? existing.priceMinor;
      const paidTiers = await this.prisma.registrationTicketType.count({ where: { productId, isActive: true, priceMinor: { gt: 0 } } });
      const isPaid = (!willBeFree && (price ?? 0) > 0) || paidTiers > 0;
      if (isPaid && !(await this.orgHasPayout(orgId))) throw new ForbiddenException(this.PAYOUT_GATE_MSG);
    }
    if (dto.botId !== undefined && dto.botId) {
      const bot = await this.prisma.bot.findFirst({ where: { id: dto.botId, organizationId: orgId }, select: { id: true } });
      if (!bot) throw new NotFoundException('Bot not found');
    }
    // Resolve slug: explicit new slug wins; otherwise auto-generate one the first time an event is
    // made public without one. Never null out an existing slug (shared links must keep working).
    let slugUpdate: string | undefined;
    if (dto.slug !== undefined && dto.slug.trim()) {
      slugUpdate = await this.ensureUniqueSlug(this.slugifyBase(dto.slug), productId);
    } else if (dto.isPublic === true && !existing.slug) {
      slugUpdate = await this.ensureUniqueSlug(this.slugifyBase(dto.name ?? existing.name), productId);
    }
    return this.prisma.registrationProduct.update({
      where: { id: productId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.eventDate !== undefined && { eventDate: dto.eventDate ? new Date(dto.eventDate) : null }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.isFree !== undefined && { isFree: dto.isFree }),
        ...(dto.priceMinor !== undefined && { priceMinor: dto.priceMinor }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.requiresApproval !== undefined && { requiresApproval: dto.requiresApproval }),
        ...(dto.allowDuplicateRegistrations !== undefined && { allowDuplicateRegistrations: dto.allowDuplicateRegistrations }),
        ...(dto.confirmationMessage !== undefined && { confirmationMessage: dto.confirmationMessage }),
        ...(dto.fields !== undefined && { fields: dto.fields as any }),
        ...(dto.botId !== undefined && { botId: dto.botId || null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        ...(slugUpdate !== undefined && { slug: slugUpdate }),
        ...(dto.bannerUrl !== undefined && { bannerUrl: dto.bannerUrl || null }),
        ...(dto.flierUrl !== undefined && { flierUrl: dto.flierUrl || null }),
        ...(dto.venue !== undefined && { venue: dto.venue || null }),
        ...(dto.reminderBeforeEvent !== undefined && { reminderBeforeEvent: dto.reminderBeforeEvent }),
        ...(dto.reminderUnpaidNudge !== undefined && { reminderUnpaidNudge: dto.reminderUnpaidNudge }),
      },
      include: { _count: { select: { entries: true } }, ticketTypes: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
  }

  async deleteProduct(orgId: string, productId: string) {
    const existing = await this.prisma.registrationProduct.findFirst({ where: { id: productId, orgId } });
    if (!existing) throw new NotFoundException('Registration product not found');
    await this.prisma.registrationProduct.delete({ where: { id: productId } });
    return { deleted: true };
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  async listEntries(orgId: string, productId: string) {
    await this.getProduct(orgId, productId);
    return this.prisma.registrationEntry.findMany({
      where: { productId, orgId },
      orderBy: { createdAt: 'desc' },
      include: { ticketType: { select: { id: true, name: true } } },
    });
  }

  async getEntry(orgId: string, entryId: string) {
    const entry = await this.prisma.registrationEntry.findFirst({
      where: { id: entryId, orgId },
      include: { product: true },
    });
    if (!entry) throw new NotFoundException('Registration entry not found');
    return entry;
  }

  async updateEntryStatus(orgId: string, entryId: string, dto: UpdateRegistrationEntryDto) {
    const entry = await this.prisma.registrationEntry.findFirst({ where: { id: entryId, orgId } });
    if (!entry) throw new NotFoundException('Registration entry not found');
    if (entry.status === 'CANCELLED') throw new BadRequestException('Cannot update a cancelled entry');
    return this.prisma.registrationEntry.update({
      where: { id: entryId },
      data: { status: dto.status },
    });
  }

  // ── Bot-facing helpers ────────────────────────────────────────────────────

  async getActiveProductsForBot(botId: string, orgId: string) {
    return this.prisma.registrationProduct.findMany({
      // botId is null for events created with "— Any bot —" — include those alongside
      // events explicitly linked to this bot.
      where: { orgId, isActive: true, OR: [{ botId }, { botId: null }] },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getProductById(productId: string, orgId: string) {
    return this.prisma.registrationProduct.findFirst({
      where: { id: productId, orgId },
    });
  }

  private normalizeEmail(email: string | null | undefined): string | null {
    const trimmed = (email ?? '').trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }

  /** Spots consumed by an event = SUM of quantities across non-cancelled entries. */
  async getUsedSpots(productId: string, tx?: any, ticketTypeId?: string): Promise<number> {
    const client = tx ?? this.prisma;
    const agg = await client.registrationEntry.aggregate({
      where: { productId, status: { not: 'CANCELLED' }, ...(ticketTypeId ? { ticketTypeId } : {}) },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  // ── Ticket tiers (CRUD) ─────────────────────────────────────────────────────
  private async assertProduct(orgId: string, productId: string) {
    const product = await this.prisma.registrationProduct.findFirst({ where: { id: productId, orgId }, select: { id: true } });
    if (!product) throw new NotFoundException('Registration product not found');
    return product;
  }

  async listTicketTypes(orgId: string, productId: string) {
    await this.assertProduct(orgId, productId);
    const tiers = await this.prisma.registrationTicketType.findMany({
      where: { productId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return Promise.all(tiers.map(async (t) => ({ ...t, usedSpots: await this.getUsedSpots(productId, undefined, t.id) })));
  }

  async createTicketType(orgId: string, productId: string, dto: CreateTicketTypeDto) {
    await this.assertProduct(orgId, productId);
    // Gate: adding a PAID tier to an already-public event requires a connected payout account —
    // otherwise it bypasses the publish gate and paid tickets would sell into the platform account.
    if ((dto.priceMinor ?? 0) > 0) {
      const product = await this.prisma.registrationProduct.findUnique({ where: { id: productId }, select: { isPublic: true } });
      if (product?.isPublic && !(await this.orgHasPayout(orgId))) throw new ForbiddenException(this.PAYOUT_GATE_MSG);
    }
    return this.prisma.registrationTicketType.create({
      data: {
        productId,
        name: dto.name,
        description: dto.description ?? null,
        priceMinor: dto.priceMinor ?? null,
        currency: dto.currency ?? 'NGN',
        capacity: dto.capacity ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateTicketType(orgId: string, ticketTypeId: string, dto: UpdateTicketTypeDto) {
    const tier = await this.prisma.registrationTicketType.findFirst({
      where: { id: ticketTypeId, product: { orgId } },
      select: { id: true, productId: true },
    });
    if (!tier) throw new NotFoundException('Ticket type not found');
    // Gate: turning a tier paid (or re-pricing it up) on a public event requires a payout account.
    if (dto.priceMinor !== undefined && dto.priceMinor > 0) {
      const product = await this.prisma.registrationProduct.findUnique({ where: { id: tier.productId }, select: { isPublic: true } });
      if (product?.isPublic && !(await this.orgHasPayout(orgId))) throw new ForbiddenException(this.PAYOUT_GATE_MSG);
    }
    // Capacity can be raised, lowered, or removed (null = unlimited) — but never set below the number
    // already sold or held for this tier, or those tickets would be stranded above the cap.
    if (dto.capacity !== undefined && dto.capacity !== null) {
      const used = await this.getUsedSpots(tier.productId, undefined, ticketTypeId);
      if (dto.capacity < used) {
        throw new BadRequestException(`Capacity can't be lower than the ${used} ticket(s) already sold or reserved for this type.`);
      }
    }
    return this.prisma.registrationTicketType.update({
      where: { id: ticketTypeId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description || null }),
        ...(dto.priceMinor !== undefined && { priceMinor: dto.priceMinor }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /** Soft-delete: deactivate the tier. Entries keep their (now-inactive) ticketTypeId for history. */
  async deleteTicketType(orgId: string, ticketTypeId: string) {
    const tier = await this.prisma.registrationTicketType.findFirst({
      where: { id: ticketTypeId, product: { orgId } },
      select: { id: true },
    });
    if (!tier) throw new NotFoundException('Ticket type not found');
    await this.prisma.registrationTicketType.update({ where: { id: ticketTypeId }, data: { isActive: false } });
    return { ok: true };
  }

  /** True when the event is full for the requested quantity. */
  async isAtCapacity(productId: string, capacity: number | null, requestedQty = 1): Promise<boolean> {
    if (capacity === null) return false;
    const used = await this.getUsedSpots(productId);
    return used + requestedQty > capacity;
  }

  /**
   * Create a registration entry with atomic capacity reservation and per-event dedup.
   * Serializes concurrent registrations on the product row (FOR UPDATE) so capacity cannot
   * be oversold, and (unless the event allows duplicates) collapses repeat registrations
   * for the same email onto the existing entry instead of creating a second one.
   */
  async createEntry(data: {
    productId: string;
    orgId: string;
    botId?: string;
    conversationId?: string;
    actionTaskId?: string;
    customerName?: string;
    customerEmail?: string;
    collectedFields: Record<string, string>;
    isFree: boolean;
    requiresApproval: boolean;
    quantity?: number;
    priceMinor?: number | null;
    capacity?: number | null;
    allowDuplicateRegistrations?: boolean;
    ticketTypeId?: string | null;
    tierCapacity?: number | null;
  }): Promise<{ outcome: 'CREATED' | 'ALREADY_REGISTERED' | 'PENDING_EXISTS' | 'AT_CAPACITY'; entry?: any; spotsLeft?: number }> {
    const quantity = Math.max(1, Math.min(50, Math.floor(data.quantity ?? 1)));
    const normalizedEmail = this.normalizeEmail(data.customerEmail);
    const status = data.isFree
      ? (data.requiresApproval ? 'AWAITING_APPROVAL' : 'CONFIRMED')
      : 'PENDING_PAYMENT';
    const amountMinor = data.isFree ? 0 : (data.priceMinor ?? 0) * quantity;

    const result = await this.prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      // Serialize registrations for this product so the capacity check-and-reserve is atomic.
      await tx.$queryRawUnsafe(`SELECT id FROM "RegistrationProduct" WHERE id = $1 FOR UPDATE`, data.productId);

      // Dedup: unless the event allows duplicates, one active entry per email.
      if (!data.allowDuplicateRegistrations && normalizedEmail) {
        const existing = await txAny.registrationEntry.findFirst({
          where: {
            productId: data.productId,
            status: { not: 'CANCELLED' },
            customerEmail: { equals: normalizedEmail, mode: 'insensitive' },
          },
          orderBy: { createdAt: 'desc' },
          include: { product: true },
        });
        if (existing) {
          if (existing.status === 'PENDING_PAYMENT') {
            return { outcome: 'PENDING_EXISTS' as const, entry: existing };
          }
          return { outcome: 'ALREADY_REGISTERED' as const, entry: existing };
        }
      }

      // Atomic capacity reserve — event-level (overall) first, then per-tier if the tier is capped.
      if (data.capacity !== null && data.capacity !== undefined) {
        const used = await this.getUsedSpots(data.productId, txAny);
        if (used + quantity > data.capacity) {
          return { outcome: 'AT_CAPACITY' as const, spotsLeft: Math.max(0, data.capacity - used) };
        }
      }
      if (data.ticketTypeId && data.tierCapacity !== null && data.tierCapacity !== undefined) {
        const usedTier = await this.getUsedSpots(data.productId, txAny, data.ticketTypeId);
        if (usedTier + quantity > data.tierCapacity) {
          return { outcome: 'AT_CAPACITY' as const, spotsLeft: Math.max(0, data.tierCapacity - usedTier) };
        }
      }

      const entry = await txAny.registrationEntry.create({
        data: {
          productId: data.productId,
          ticketTypeId: data.ticketTypeId ?? null,
          orgId: data.orgId,
          botId: data.botId ?? null,
          conversationId: data.conversationId ?? null,
          actionTaskId: data.actionTaskId ?? null,
          customerName: data.customerName ?? null,
          // Store the normalized email so dedup and receipts are consistent.
          customerEmail: normalizedEmail,
          collectedFields: data.collectedFields as any,
          status: status as any,
          quantity,
          amountMinor,
          checkInCode: this.newCheckInCode(),
        },
        include: { product: true },
      });
      return { outcome: 'CREATED' as const, entry };
    });

    // Free events skip payment entirely — send the ticket as soon as the entry is confirmed.
    if (result.outcome === 'CREATED' && data.isFree && (status === 'CONFIRMED' || status === 'AWAITING_APPROVAL')) {
      await this.enqueueRegistrationReceipt(result.entry.id, data.orgId);
    }

    if (result.outcome === 'CREATED') this.linkEntriesToCustomer(data.orgId, [result.entry.id], data.conversationId);
    return result;
  }

  private async enqueueRegistrationReceipt(entryId: string, orgId: string) {
    try {
      await this.receiptsQueue.add(
        RECEIPT_JOB.REGISTRATION,
        { entryId, orgId },
        RECEIPT_JOB_OPTIONS,
      );
    } catch (err) {
      this.logger.error(`Failed to enqueue registration receipt job for entry ${entryId}: ${String(err)}`);
    }
  }

  // ── Public event page (self-serve) ─────────────────────────────────────────
  /** Public, unauthenticated view of an event by slug — only when published (isPublic && isActive).
   *  Returns a curated payload (no orgId/botId leakage) with per-tier and overall availability. */
  async getPublicEventBySlug(slug: string) {
    const product = await this.prisma.registrationProduct.findFirst({
      where: { slug, isPublic: true, isActive: true },
      include: {
        ticketTypes: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        organization: { select: { name: true } },
      },
    });
    if (!product) throw new NotFoundException('Event not found');

    const usedTotal = await this.getUsedSpots(product.id);
    const ticketTypes = await Promise.all(product.ticketTypes.map(async (t) => {
      const used = await this.getUsedSpots(product.id, undefined, t.id);
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        priceMinor: t.priceMinor ?? 0,
        currency: t.currency,
        isFree: !t.priceMinor,
        spotsLeft: t.capacity != null ? Math.max(0, t.capacity - used) : null,
        soldOut: t.capacity != null && used >= t.capacity,
      };
    }));

    return {
      slug: product.slug,
      name: product.name,
      description: product.description,
      eventDate: product.eventDate,
      venue: product.venue,
      bannerUrl: product.bannerUrl,
      flierUrl: product.flierUrl,
      currency: product.currency,
      isFree: product.isFree,
      priceMinor: product.priceMinor ?? 0, // legacy single price (used only when there are no tiers)
      requiresApproval: product.requiresApproval,
      fields: Array.isArray(product.fields) ? product.fields : [],
      hasTiers: ticketTypes.length > 0,
      ticketTypes,
      capacity: product.capacity,
      spotsLeft: product.capacity != null ? Math.max(0, product.capacity - usedTotal) : null,
      soldOut: product.capacity != null && usedTotal >= product.capacity,
      organizerName: product.organization?.name ?? null,
    };
  }

  /** Self-serve registration/purchase from the public page. Resolves the tier (price authoritative
   *  from the tier, never the client), validates required fields, reserves capacity, and either
   *  returns a Paystack link (paid) or confirms + issues a ticket (free). Reuses the same entry +
   *  payment + ticket pipeline as the bot. */
  async registerPublic(slug: string, dto: PublicRegisterDto): Promise<{
    outcome: 'PENDING_PAYMENT' | 'CONFIRMED' | 'AWAITING_APPROVAL' | 'ALREADY_REGISTERED' | 'AT_CAPACITY';
    paymentUrl?: string; reference?: string; ticketUrl?: string; entryId?: string; spotsLeft?: number;
  }> {
    const product = await this.prisma.registrationProduct.findFirst({
      where: { slug, isPublic: true, isActive: true },
      include: { ticketTypes: { where: { isActive: true } } },
    });
    if (!product) throw new NotFoundException('Event not found');

    // Resolve the tier — price and per-tier capacity come from the catalog, never the request body.
    let ticketTypeId: string | null = null;
    let priceMinor: number | null = product.priceMinor ?? null;
    let isFree = product.isFree;
    let tierCapacity: number | null = null;
    if (product.ticketTypes.length > 0) {
      if (!dto.ticketTypeId) throw new BadRequestException('Please select a ticket type');
      const tier = product.ticketTypes.find((t) => t.id === dto.ticketTypeId);
      if (!tier) throw new BadRequestException('That ticket type is not available for this event');
      ticketTypeId = tier.id;
      priceMinor = tier.priceMinor ?? null;
      isFree = !tier.priceMinor;
      tierCapacity = tier.capacity ?? null;
    }

    // Required custom fields (plus name/email).
    const collected: Record<string, string> = { ...(dto.fields ?? {}) };
    if (dto.customerName) collected.customer_name = dto.customerName.trim();
    collected.customer_email = dto.customerEmail.trim();
    const productFields = (Array.isArray(product.fields) ? product.fields : []) as { key: string; label: string; required: boolean }[];
    const requiredKeys = ['customer_name', 'customer_email', ...productFields.filter((f) => f.required).map((f) => f.key)];
    const missing = requiredKeys.filter((k) => !collected[k] || String(collected[k]).trim().length === 0);
    if (missing.length > 0) {
      const labels = missing.map((k) => (k === 'customer_name' ? 'full name' : k === 'customer_email' ? 'email address' : (productFields.find((f) => f.key === k)?.label ?? k)));
      throw new BadRequestException(`Missing required details: ${labels.join(', ')}`);
    }

    const quantity = Math.max(1, Math.min(50, Math.floor(dto.quantity ?? 1)));
    const result = await this.createEntry({
      productId: product.id,
      orgId: product.orgId,
      customerName: collected.customer_name,
      customerEmail: collected.customer_email,
      collectedFields: collected,
      isFree,
      requiresApproval: product.requiresApproval,
      quantity,
      priceMinor,
      capacity: product.capacity,
      allowDuplicateRegistrations: product.allowDuplicateRegistrations === true,
      ticketTypeId,
      tierCapacity,
    });

    const appUrl = this.getPublicAppUrl();
    if (result.outcome === 'AT_CAPACITY') {
      return { outcome: 'AT_CAPACITY', spotsLeft: result.spotsLeft ?? 0 };
    }
    if (result.outcome === 'ALREADY_REGISTERED') {
      return { outcome: 'ALREADY_REGISTERED', ticketUrl: `${appUrl}/ticket/${result.entry.id}`, entryId: result.entry.id };
    }

    const entry = result.entry;
    // Paid (or an unpaid entry already exists) → hand back a Paystack checkout link (idempotent).
    if (!isFree && entry.customerEmail) {
      const { paymentUrl, reference } = await this.initializePayment(entry.id, product.orgId);
      return { outcome: 'PENDING_PAYMENT', paymentUrl, reference, entryId: entry.id };
    }
    return {
      outcome: entry.status === 'AWAITING_APPROVAL' ? 'AWAITING_APPROVAL' : 'CONFIRMED',
      ticketUrl: `${appUrl}/ticket/${entry.id}`,
      entryId: entry.id,
    };
  }

  // ── Cart checkout (multi-ticket, multi-attendee, one payment) ────────────────
  /** Public-page cart: resolve the published event by slug, then run the cart checkout. */
  async registerPublicCart(slug: string, dto: PublicCartDto) {
    const product = await this.prisma.registrationProduct.findFirst({
      where: { slug, isPublic: true, isActive: true },
      select: { id: true, orgId: true },
    });
    if (!product) throw new NotFoundException('Event not found');
    return this.registerCart({
      productId: product.id,
      orgId: product.orgId,
      payerName: dto.customerName,
      payerEmail: dto.customerEmail,
      items: dto.items ?? [],
    });
  }

  /**
   * Buy multiple tickets in one purchase — across tiers and/or for different people — paid once.
   * Every unit becomes its OWN entry with its own QR (so attendees arrive independently), all grouped
   * by purchaseGroupId under a single Paystack payment. Capacity for the whole cart is reserved
   * atomically. Shared by the public page and the AI agent.
   */
  async registerCart(params: {
    productId: string;
    orgId: string;
    botId?: string;
    conversationId?: string;
    payerName?: string;
    payerEmail: string;
    items: Array<{ ticketTypeId?: string; ticketTypeName?: string; quantity?: number; attendees?: Array<{ name?: string; email?: string; fields?: Record<string, string> }> }>;
  }): Promise<{
    outcome: 'PENDING_PAYMENT' | 'CONFIRMED' | 'AWAITING_APPROVAL' | 'AT_CAPACITY' | 'PRODUCT_NOT_FOUND' | 'MISSING_FIELDS' | 'NEEDS_TICKET_TYPE';
    paymentUrl?: string; reference?: string; groupId?: string; amount?: string; spotsLeft?: number;
    message?: string; missing?: string[];
    ticketTypes?: Array<{ id: string; name: string; price: string; spots_left: number | null }>;
    tickets?: Array<{ entryId: string; ticketUrl: string; attendeeName: string | null; ticketType: string | null }>;
  }> {
    const prismaAny = this.prisma as any;
    const product = await prismaAny.registrationProduct.findFirst({
      where: { id: params.productId, orgId: params.orgId, isActive: true },
      include: { ticketTypes: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!product) return { outcome: 'PRODUCT_NOT_FOUND', message: 'No active event matches that id.' };

    const tiers = product.ticketTypes as Array<{ id: string; name: string; priceMinor: number | null; capacity: number | null }>;
    const payerName = params.payerName?.trim() || null;
    const payerEmail = this.normalizeEmail(params.payerEmail) ?? '';
    if (!payerEmail) return { outcome: 'MISSING_FIELDS', message: 'A payer email is required.', missing: ['customer_email'] };

    const productFields = (Array.isArray(product.fields) ? product.fields : []) as { key: string; label: string; required: boolean }[];
    const requiredFieldKeys = productFields.filter((f) => f.required).map((f) => f.key);

    // Expand each cart line into individual tickets (one per unit), resolving the tier for each.
    type Ticket = { ticketTypeId: string | null; tierName: string | null; priceMinor: number | null; isFree: boolean; name: string | null; email: string; fields: Record<string, string> };
    const tickets: Ticket[] = [];
    for (const item of params.items) {
      let tier: (typeof tiers)[number] | null = null;
      if (tiers.length > 0) {
        const nameQ = (item.ticketTypeName ?? '').trim().toLowerCase();
        tier =
          tiers.find((t) => t.id === item.ticketTypeId) ??
          (nameQ
            ? tiers.find((t) => t.name.trim().toLowerCase() === nameQ) ??
              tiers.find((t) => { const tn = t.name.trim().toLowerCase(); return tn.includes(nameQ) || nameQ.includes(tn); }) ?? null
            : null) ??
          (tiers.length === 1 ? tiers[0] : null);
        if (!tier) {
          const money = (m: number | null) => (m && m > 0 ? `${product.currency} ${(m / 100).toFixed(2)}` : 'Free');
          const ticket_types = await Promise.all(tiers.map(async (t) => ({ id: t.id, name: t.name, price: money(t.priceMinor), spots_left: t.capacity != null ? Math.max(0, t.capacity - (await this.getUsedSpots(product.id, undefined, t.id))) : null })));
          return { outcome: 'NEEDS_TICKET_TYPE', ticketTypes: ticket_types, message: `"${product.name}" has ticket tiers — specify which tier for each ticket.` };
        }
      }
      const explicitCount = item.attendees?.length ?? 0;
      const qty = Math.max(1, Math.min(50, Math.floor(item.quantity ?? explicitCount ?? 1)));
      const priceMinor = tier ? tier.priceMinor : product.priceMinor;
      const isFree = tier ? !tier.priceMinor : product.isFree;
      for (let i = 0; i < qty; i++) {
        const att = item.attendees?.[i] ?? {};
        tickets.push({
          ticketTypeId: tier?.id ?? null,
          tierName: tier?.name ?? null,
          priceMinor,
          isFree,
          name: (att.name ?? payerName ?? '') || null,
          email: this.normalizeEmail(att.email) ?? payerEmail,
          fields: { ...(att.fields ?? {}) },
        });
      }
    }
    if (tickets.length === 0) return { outcome: 'MISSING_FIELDS', message: 'No tickets selected.' };

    // Each ticket needs a name, email, and the event's required fields.
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      const missing: string[] = [];
      if (!t.name) missing.push('name');
      if (!t.email) missing.push('email');
      for (const k of requiredFieldKeys) if (!t.fields[k] || !String(t.fields[k]).trim()) missing.push(k);
      if (missing.length) return { outcome: 'MISSING_FIELDS', message: `Ticket ${i + 1} is missing: ${missing.join(', ')}.`, missing };
    }

    const totalMinor = tickets.reduce((s, t) => s + (t.isFree ? 0 : (t.priceMinor ?? 0)), 0);
    const paidCart = totalMinor > 0;
    const groupId = randomBytes(12).toString('hex');

    // Reserve the whole cart's capacity atomically, then create every ticket, in one transaction.
    const reserve = await this.prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      await tx.$queryRawUnsafe(`SELECT id FROM "RegistrationProduct" WHERE id = $1 FOR UPDATE`, product.id);
      if (product.capacity != null) {
        const used = await this.getUsedSpots(product.id, txAny);
        if (used + tickets.length > product.capacity) return { ok: false as const, spotsLeft: Math.max(0, product.capacity - used) };
      }
      const byTier = new Map<string, number>();
      for (const t of tickets) if (t.ticketTypeId) byTier.set(t.ticketTypeId, (byTier.get(t.ticketTypeId) ?? 0) + 1);
      for (const [tierId, count] of byTier) {
        const tier = tiers.find((t) => t.id === tierId);
        if (tier?.capacity != null) {
          const usedTier = await this.getUsedSpots(product.id, txAny, tierId);
          if (usedTier + count > tier.capacity) return { ok: false as const, spotsLeft: Math.max(0, tier.capacity - usedTier) };
        }
      }
      const ids: string[] = [];
      for (const t of tickets) {
        const status = paidCart ? 'PENDING_PAYMENT' : (product.requiresApproval ? 'AWAITING_APPROVAL' : 'CONFIRMED');
        const e = await txAny.registrationEntry.create({
          data: {
            productId: product.id, ticketTypeId: t.ticketTypeId, orgId: params.orgId, botId: params.botId ?? null, conversationId: params.conversationId ?? null,
            purchaseGroupId: groupId, customerName: t.name, customerEmail: t.email, collectedFields: t.fields as any,
            status: status as any, quantity: 1, amountMinor: t.isFree ? 0 : (t.priceMinor ?? 0), checkInCode: this.newCheckInCode(),
          },
          select: { id: true },
        });
        ids.push(e.id);
      }
      return { ok: true as const, ids };
    });

    if (!reserve.ok) {
      return { outcome: 'AT_CAPACITY', spotsLeft: reserve.spotsLeft, message: reserve.spotsLeft > 0 ? `Only ${reserve.spotsLeft} spot(s) left — fewer than requested.` : `${product.name} is fully booked.` };
    }
    this.linkEntriesToCustomer(params.orgId, reserve.ids, params.conversationId); // buyer's conversation → Customer

    const appUrl = this.getPublicAppUrl();
    const ticketsOut = reserve.ids.map((id, i) => ({ entryId: id, ticketUrl: `${appUrl}/ticket/${id}`, attendeeName: tickets[i].name, ticketType: tickets[i].tierName }));
    const money = (m: number) => `${product.currency} ${(m / 100).toFixed(2)}`;

    if (paidCart) {
      try {
        const pay = await this.initializeGroupPayment(groupId, payerEmail, totalMinor, product.currency, params.orgId);
        await this.prisma.registrationEntry.updateMany({ where: { purchaseGroupId: groupId }, data: { paystackReference: pay.reference, paystackAccessCode: pay.accessCode } });
        return { outcome: 'PENDING_PAYMENT', paymentUrl: pay.paymentUrl, reference: pay.reference, groupId, amount: money(pay.chargedAmount), tickets: ticketsOut, message: `${tickets.length} ticket(s) held. Payment of ${money(pay.chargedAmount)} confirms all of them.` };
      } catch (err) {
        this.logger.warn(`registerCart: payment init failed for group ${groupId}: ${String(err)}`);
        return { outcome: 'PENDING_PAYMENT', groupId, tickets: ticketsOut, message: 'Tickets held, but the payment link could not be generated right now. A teammate will follow up.' };
      }
    }

    // Free cart — issue each attendee their own ticket.
    for (const id of reserve.ids) await this.enqueueRegistrationReceipt(id, params.orgId);
    return { outcome: product.requiresApproval ? 'AWAITING_APPROVAL' : 'CONFIRMED', groupId, tickets: ticketsOut, message: `${tickets.length} ticket(s) confirmed.` };
  }

  /** Initialize ONE Paystack payment covering a whole cart (group of ticket entries). */
  /** The org's Paystack subaccount, so ticket money settles to the ORG (split), not Zuti's account.
   * Null when the org hasn't connected a payout account — the charge then falls back to the platform
   * (legacy behavior; publishing a paid event is gated on having one, so this is an edge case). */
  private async getOrgSubaccount(orgId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { paystackSubaccountCode: true } });
    return org?.paystackSubaccountCode ?? null;
  }

  private async orgHasPayout(orgId: string): Promise<boolean> {
    return !!(await this.getOrgSubaccount(orgId));
  }

  /** Gross up a ticket-price total so the customer pays enough to cover both the Paystack
   * processing fee and the platform fee, leaving the organiser's subaccount receiving exactly
   * `ticketMinor`. Uses Paystack Nigeria standard fee: 1.5% of gross + ₦100 flat (> ₦2,500),
   * capped at ₦2,000. `transactionCharge` is passed to Paystack as `transaction_charge`; with
   * `bearer: 'account'`, Paystack deducts its actual fee from Zuti's cut — absorbing any
   * rounding variance — while the subaccount always receives exactly `ticketMinor`. */
  private computeRegistrationGross(ticketMinor: number): { gross: number; transactionCharge: number } {
    if (ticketMinor <= 0) return { gross: 0, transactionCharge: 0 };
    const PLATFORM_RATE    = 0.05;     // 5% of ticket price goes to Zuti's main account
    const PS_RATE          = 0.015;    // Paystack 1.5% of gross charge
    const PS_FLAT_KS       = 10_000;   // ₦100 in kobo (applied when gross > ₦2,500)
    const PS_FLAT_THRESH   = 250_000;  // ₦2,500 in kobo
    const PS_CAP           = 200_000;  // ₦2,000 cap in kobo

    const platformFee = Math.ceil(ticketMinor * PLATFORM_RATE);
    const base = ticketMinor + platformFee;

    // Solve gross = base + paystackFee(gross) iteratively — converges in ≤ 3 steps.
    let gross = base;
    for (let i = 0; i < 3; i++) {
      const flat = gross > PS_FLAT_THRESH ? PS_FLAT_KS : 0;
      gross = base + Math.min(PS_CAP, Math.ceil(gross * PS_RATE) + flat);
    }
    const flat = gross > PS_FLAT_THRESH ? PS_FLAT_KS : 0;
    const paystackFee = Math.min(PS_CAP, Math.ceil(gross * PS_RATE) + flat);
    gross = base + paystackFee;
    return { gross, transactionCharge: platformFee + paystackFee };
  }

  private readonly PAYOUT_GATE_MSG = 'Connect a payout account (Billing → Payouts) before publishing a paid event, so ticket money reaches your bank.';

  private async initializeGroupPayment(groupId: string, email: string, totalMinor: number, currency: string, orgId: string): Promise<{ paymentUrl: string; reference: string; accessCode: string; chargedAmount: number }> {
    const paystackSecret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    const reference = `zuti_reg_${randomBytes(16).toString('hex')}`;
    const apiBase = (this.config.get<string>('API_URL') ?? 'http://localhost:3001').replace(/\/$/, '');
    const subaccount = await this.getOrgSubaccount(orgId);
    // When the org has a subaccount, gross up so fees don't cut into the organiser's settlement.
    // The customer pays `chargedAmount`; the subaccount receives exactly `totalMinor`; Zuti's main
    // account receives `transactionCharge` (platform fee + Paystack fee estimate). `bearer: account`
    // means Paystack deducts its actual fee from Zuti's portion, absorbing any rounding variance.
    const { gross: chargedAmount, transactionCharge } = subaccount
      ? this.computeRegistrationGross(totalMinor)
      : { gross: totalMinor, transactionCharge: 0 };
    const response = await firstValueFrom(
      this.http.post<PaystackInitResponse>('https://api.paystack.co/transaction/initialize', {
        amount: chargedAmount,
        email,
        currency,
        reference,
        callback_url: `${apiBase}/api/public/tickets/payment/callback`,
        metadata: { organizationId: orgId, registrationGroupId: groupId, source: 'zuti-registration-cart' },
        ...(subaccount ? { subaccount, bearer: 'account', transaction_charge: transactionCharge } : {}),
      }, { headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' } }),
    );
    if (!response.data?.status || !response.data.data?.authorization_url) {
      throw new BadRequestException(`Paystack initialization failed: ${response.data?.message ?? 'Unknown error'}`);
    }
    return { paymentUrl: response.data.data.authorization_url, reference: response.data.data.reference, accessCode: response.data.data.access_code, chargedAmount };
  }

  // ── Tool-use entrypoint ─────────────────────────────────────────────────────
  // Single self-contained "register_for_event" tool the AI agent calls. It does the real work
  // (dedup, atomic capacity reserve, entry creation, payment init) and returns a structured,
  // truthful result the model composes its reply from — no post-hoc guardrails needed.

  async executeRegistrationTool(params: {
    orgId: string;
    botId?: string;
    conversationId?: string;
    productId: string;
    ticketTypeId?: string;
    ticketTypeName?: string;
    quantity?: number;
    customerName?: string;
    customerEmail?: string;
    fields?: Record<string, string>;
  }): Promise<{
    outcome: 'PENDING_PAYMENT' | 'CONFIRMED' | 'AWAITING_APPROVAL' | 'ALREADY_REGISTERED' | 'AT_CAPACITY' | 'PRODUCT_NOT_FOUND' | 'MISSING_FIELDS' | 'NEEDS_TICKET_TYPE';
    message: string;
    payment_url?: string;
    ticket_url?: string;
    spots_left?: number;
    missing_fields?: string[];
    amount?: string;
    ticket_types?: Array<{ id: string; name: string; price: string; spots_left: number | null }>;
  }> {
    const prismaAny = this.prisma as any;
    const product = await prismaAny.registrationProduct.findFirst({
      where: { id: params.productId, orgId: params.orgId, isActive: true },
      include: { ticketTypes: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!product) {
      return { outcome: 'PRODUCT_NOT_FOUND', message: 'No active event matches that id. Ask the customer which event they mean.' };
    }

    // Tiered events: the customer must pick a tier, and the PRICE comes from the tier (never typed).
    // If no valid tier was chosen, hand the model the list so it can ask — mirrors search_products.
    const tiers = (product.ticketTypes ?? []) as Array<{ id: string; name: string; priceMinor: number | null; currency: string; capacity: number | null }>;
    let chosenTier: (typeof tiers)[number] | null = null;
    if (tiers.length > 0) {
      // Resolve the tier robustly so the model never gets stuck: (a) exact id, (b) by NAME — the
      // customer said the tier name, so the model shouldn't have to carry an opaque id across turns,
      // (c) if there's only ONE tier there is nothing to choose, so auto-select it. Only fall back to
      // asking when there are genuinely multiple tiers and none was matched.
      const nameQ = (params.ticketTypeName ?? '').trim().toLowerCase();
      chosenTier =
        tiers.find((t) => t.id === params.ticketTypeId) ??
        (nameQ
          ? tiers.find((t) => t.name.trim().toLowerCase() === nameQ) ??
            tiers.find((t) => { const tn = t.name.trim().toLowerCase(); return tn.includes(nameQ) || nameQ.includes(tn); }) ??
            null
          : null) ??
        (tiers.length === 1 ? tiers[0] : null);
      if (!chosenTier) {
        const moneyT = (m: number | null) => (m && m > 0 ? `${product.currency ?? 'NGN'} ${(m / 100).toFixed(2)}` : 'Free');
        const ticket_types = await Promise.all(tiers.map(async (t) => ({
          id: t.id,
          name: t.name,
          price: moneyT(t.priceMinor),
          spots_left: t.capacity != null ? Math.max(0, t.capacity - (await this.getUsedSpots(product.id, undefined, t.id))) : null,
        })));
        return {
          outcome: 'NEEDS_TICKET_TYPE',
          ticket_types,
          message: `"${product.name}" has ticket tiers. Ask the customer which one they want, then call register_for_event again with its ticket_type_id. Options: ${ticket_types.map((t) => `${t.name} (${t.price}${t.spots_left != null ? `, ${t.spots_left} left` : ''})`).join('; ')}.`,
        };
      }
    }

    const collected: Record<string, string> = { ...(params.fields ?? {}) };
    if (params.customerName) collected.customer_name = params.customerName.trim();
    if (params.customerEmail) collected.customer_email = params.customerEmail.trim();

    const productFields = (Array.isArray(product.fields) ? product.fields : []) as { key: string; label: string; required: boolean }[];
    const requiredKeys = ['customer_name', 'customer_email', ...productFields.filter((f) => f.required).map((f) => f.key)];
    const missing = requiredKeys.filter((k) => !collected[k] || String(collected[k]).trim().length === 0);
    if (missing.length > 0) {
      const labels = missing.map((k) => (k === 'customer_name' ? 'full name' : k === 'customer_email' ? 'email address' : (productFields.find((f) => f.key === k)?.label ?? k)));
      return { outcome: 'MISSING_FIELDS', message: `Cannot register yet — still need: ${labels.join(', ')}. Ask the customer for these.`, missing_fields: missing };
    }

    const quantity = Math.max(1, Math.min(50, Math.floor(params.quantity ?? 1)));
    const result = await this.createEntry({
      productId: product.id,
      orgId: params.orgId,
      botId: params.botId,
      conversationId: params.conversationId,
      customerName: collected.customer_name,
      customerEmail: collected.customer_email,
      collectedFields: collected,
      // Price/free-ness come from the chosen tier when the event is tiered; otherwise the event's own.
      isFree: chosenTier ? !chosenTier.priceMinor : product.isFree,
      requiresApproval: product.requiresApproval,
      quantity,
      priceMinor: chosenTier ? (chosenTier.priceMinor ?? null) : product.priceMinor,
      capacity: product.capacity,
      allowDuplicateRegistrations: product.allowDuplicateRegistrations === true,
      ticketTypeId: chosenTier?.id ?? null,
      tierCapacity: chosenTier?.capacity ?? null,
    });

    const resolvedIsFree = chosenTier ? !chosenTier.priceMinor : product.isFree;
    const resolvedUnit = chosenTier ? (chosenTier.priceMinor ?? 0) : (product.priceMinor ?? 0);
    const appUrl = this.getPublicAppUrl();
    const money = (minor: number) => `${product.currency ?? 'NGN'} ${(minor / 100).toFixed(2)}`;

    if (result.outcome === 'AT_CAPACITY') {
      const left = result.spotsLeft ?? 0;
      return {
        outcome: 'AT_CAPACITY',
        spots_left: left,
        message: left > 0
          ? `Only ${left} spot(s) remain — fewer than the ${quantity} requested. Offer the customer the available number or a smaller quantity.`
          : `${product.name} is fully booked. Let the customer know registration is closed.`,
      };
    }

    if (result.outcome === 'ALREADY_REGISTERED') {
      return {
        outcome: 'ALREADY_REGISTERED',
        ticket_url: `${appUrl}/ticket/${result.entry.id}`,
        message: `This email already has an active registration for ${product.name}. Tell the customer they're already registered and share their ticket link.`,
      };
    }

    const entry = result.entry;
    if (!resolvedIsFree && entry.customerEmail) {
      try {
        const { paymentUrl, chargedAmount } = await this.initializePayment(entry.id, params.orgId);
        const total = chargedAmount > 0 ? chargedAmount : ((entry.amountMinor && entry.amountMinor > 0) ? entry.amountMinor : resolvedUnit * quantity);
        return {
          outcome: 'PENDING_PAYMENT',
          payment_url: paymentUrl,
          amount: money(total),
          message: `Details captured for ${quantity} ticket(s) to ${product.name}. Payment of ${money(total)} is required to finalize — give the customer the payment link and make clear the registration is not complete until they pay.`,
        };
      } catch {
        return { outcome: 'PENDING_PAYMENT', message: 'Details captured, but the payment link could not be generated right now. Tell the customer a teammate will follow up with payment details.' };
      }
    }

    // Free event — confirmed (or awaiting approval); ticket email already enqueued by createEntry.
    return {
      outcome: entry.status,
      ticket_url: `${appUrl}/ticket/${entry.id}`,
      message: entry.status === 'AWAITING_APPROVAL'
        ? `Registration recorded for ${product.name}; it needs organizer approval. Tell the customer it's pending approval and their ticket has been emailed.`
        : `Registration confirmed for ${quantity} ticket(s) to ${product.name}. Confirm to the customer and mention their ticket has been emailed.`,
    };
  }

  /**
   * Cart variant of the AI tool: the customer is buying multiple tickets, possibly across tiers and
   * for different attendees, paid once. Each element of `tickets` becomes its own ticket (own QR).
   * Delegates the real work to registerCart (atomic reserve-all + one grouped payment) and adapts
   * the result into the same flat shape register_for_event returns, so the model's reply logic is
   * unchanged.
   */
  async executeRegistrationCartTool(params: {
    orgId: string;
    botId?: string;
    conversationId?: string;
    productId: string;
    customerName?: string;
    customerEmail?: string;
    tickets: Array<{ ticketTypeId?: string; ticketTypeName?: string; name?: string; email?: string; fields?: Record<string, string> }>;
  }): Promise<{
    outcome: 'PENDING_PAYMENT' | 'CONFIRMED' | 'AWAITING_APPROVAL' | 'AT_CAPACITY' | 'PRODUCT_NOT_FOUND' | 'MISSING_FIELDS' | 'NEEDS_TICKET_TYPE';
    message: string;
    payment_url?: string;
    ticket_url?: string;
    ticket_urls?: string[];
    spots_left?: number;
    missing_fields?: string[];
    amount?: string;
    ticket_types?: Array<{ id: string; name: string; price: string; spots_left: number | null }>;
  }> {
    const tickets = Array.isArray(params.tickets) ? params.tickets : [];
    if (tickets.length === 0) return { outcome: 'MISSING_FIELDS', message: 'No tickets specified — ask the customer how many tickets and for whom.' };

    // One tool "ticket" = one cart item of quantity 1 with a single attendee (own QR).
    const items = tickets.map((t) => ({
      ticketTypeId: t.ticketTypeId?.trim() || undefined,
      ticketTypeName: t.ticketTypeName?.trim() || undefined,
      quantity: 1,
      attendees: [{ name: t.name?.trim() || undefined, email: t.email?.trim() || undefined, fields: t.fields ?? {} }],
    }));

    const res = await this.registerCart({
      orgId: params.orgId,
      botId: params.botId,
      conversationId: params.conversationId,
      productId: params.productId,
      payerName: params.customerName,
      payerEmail: params.customerEmail ?? '',
      items,
    });

    const ticketUrls = (res.tickets ?? []).map((t) => t.ticketUrl);
    switch (res.outcome) {
      case 'PENDING_PAYMENT':
        return {
          outcome: 'PENDING_PAYMENT',
          payment_url: res.paymentUrl,
          amount: res.amount,
          message: res.paymentUrl
            ? `${tickets.length} ticket(s) held (one per attendee). A single payment of ${res.amount} confirms them all — give the customer THIS payment link in the chat now; do not say it will be emailed. Nothing is booked until they pay.`
            : (res.message ?? 'Tickets held, but the payment link could not be generated. Tell the customer a teammate will follow up.'),
        };
      case 'CONFIRMED':
        return { outcome: 'CONFIRMED', ticket_url: ticketUrls[0], ticket_urls: ticketUrls, message: `${tickets.length} ticket(s) confirmed — each attendee has been emailed their own ticket. Confirm to the customer.` };
      case 'AWAITING_APPROVAL':
        return { outcome: 'AWAITING_APPROVAL', ticket_url: ticketUrls[0], ticket_urls: ticketUrls, message: `${tickets.length} ticket(s) recorded; they need organizer approval. Tell the customer it's pending approval.` };
      case 'AT_CAPACITY':
        return { outcome: 'AT_CAPACITY', spots_left: res.spotsLeft, message: res.message ?? 'Not enough spots left for the requested tickets.' };
      case 'NEEDS_TICKET_TYPE':
        return {
          outcome: 'NEEDS_TICKET_TYPE',
          ticket_types: res.ticketTypes,
          message: res.ticketTypes?.length
            ? `This event has ticket tiers. Ask which tier each ticket should be, then call again with ticket_type_name per ticket. Options: ${res.ticketTypes.map((t) => `${t.name} (${t.price}${t.spots_left != null ? `, ${t.spots_left} left` : ''})`).join('; ')}.`
            : (res.message ?? 'Specify the ticket tier for each ticket.'),
        };
      case 'MISSING_FIELDS':
        return { outcome: 'MISSING_FIELDS', missing_fields: res.missing, message: res.message ?? 'Missing details — ask the customer for the required information.' };
      case 'PRODUCT_NOT_FOUND':
      default:
        return { outcome: 'PRODUCT_NOT_FOUND', message: res.message ?? 'No active event matches that id.' };
    }
  }

  // ── Paystack ──────────────────────────────────────────────────────────────

  async initializePayment(entryId: string, orgId: string): Promise<{ paymentUrl: string; reference: string; chargedAmount: number }> {
    const entry = await this.prisma.registrationEntry.findFirst({
      where: { id: entryId, orgId },
      include: { product: true },
    });
    if (!entry) throw new NotFoundException('Registration entry not found');
    // Guard on the actual amount to charge (captured on the entry from its tier/price), not the
    // event-level isFree flag — a paid tier on an otherwise-"free" event must still be chargeable.
    const chargeBasis = (entry.amountMinor && entry.amountMinor > 0) ? entry.amountMinor : (entry.product.priceMinor ?? 0) * (entry.quantity ?? 1);
    if (chargeBasis <= 0) throw new BadRequestException('No payment is required for this registration');
    if (!entry.customerEmail) throw new BadRequestException('Customer email is required for payment');
    if (entry.status !== 'PENDING_PAYMENT') throw new BadRequestException('Entry is not awaiting payment');

    // Compute gross up-front (needed for both the idempotency path and the new-init path).
    const subaccountEarly = await this.getOrgSubaccount(orgId);
    const { gross: chargedAmount, transactionCharge } = subaccountEarly
      ? this.computeRegistrationGross(chargeBasis)
      : { gross: chargeBasis, transactionCharge: 0 };
    const subaccount = subaccountEarly;

    // Idempotency: if already initialized, reconstruct the checkout URL from the stored access code
    if (entry.paystackReference && entry.paystackAccessCode) {
      return {
        paymentUrl: `https://checkout.paystack.com/${entry.paystackAccessCode}`,
        reference: entry.paystackReference,
        chargedAmount,
      };
    }

    const paystackSecret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');

    // Use pure random bytes — no timestamp to avoid millisecond collisions
    const reference = `zuti_reg_${randomBytes(16).toString('hex')}`;

    // Chat-based registrants never return to a Zuti web page, so we cannot rely on a
    // frontend "verify" call the way billing does. We set a callback_url that Paystack
    // redirects the customer's browser to after payment — that endpoint confirms the
    // registration server-side and forwards to the ticket page. The webhook remains a
    // backstop (both hit the same idempotent handlePaymentConfirmed).
    const apiBase = (this.config.get<string>('API_URL') ?? 'http://localhost:3001').replace(/\/$/, '');
    const callbackUrl = `${apiBase}/api/public/tickets/payment/callback`;

    const response = await firstValueFrom(
      this.http.post<PaystackInitResponse>('https://api.paystack.co/transaction/initialize', {
        amount: chargedAmount,
        email: entry.customerEmail,
        currency: entry.product.currency,
        reference,
        callback_url: callbackUrl,
        metadata: {
          organizationId: orgId,
          registrationEntryId: entry.id,
          registrationProductId: entry.productId,
          source: 'zuti-registration',
        },
        ...(subaccount ? { subaccount, bearer: 'account', transaction_charge: transactionCharge } : {}),
      }, {
        headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' },
      }),
    );

    if (!response.data?.status || !response.data.data?.authorization_url) {
      throw new BadRequestException(`Paystack initialization failed: ${response.data?.message ?? 'Unknown error'}`);
    }

    await this.prisma.registrationEntry.update({
      where: { id: entryId },
      data: {
        paystackReference: response.data.data.reference,
        paystackAccessCode: response.data.data.access_code,
      },
    });

    return { paymentUrl: response.data.data.authorization_url, reference: response.data.data.reference, chargedAmount };
  }

  getPublicAppUrl(): string {
    return (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  /** Public payment-return handler: validates the reference shape then confirms. Safe to call
   *  from the unauthenticated Paystack callback — handlePaymentConfirmed re-verifies with Paystack. */
  async confirmPaymentByReference(reference: string): Promise<{ entry: any; product: any } | null> {
    if (!reference || !/^zuti_reg_[a-f0-9]{32}$/.test(reference)) {
      // Tolerate legacy references (older format) by still attempting confirmation, but log it.
      if (reference && reference.startsWith('zuti_reg_')) {
        return this.handlePaymentConfirmed(reference).catch((err) => {
          this.logger.warn(`confirmPaymentByReference failed for ${reference}: ${String(err)}`);
          return null;
        });
      }
      this.logger.warn(`confirmPaymentByReference: rejected malformed reference "${reference}"`);
      return null;
    }
    return this.handlePaymentConfirmed(reference).catch((err) => {
      this.logger.warn(`confirmPaymentByReference failed for ${reference}: ${String(err)}`);
      return null;
    });
  }

  /**
   * Reconciliation safety net: the webhook and browser-callback are best-effort delivery and
   * can be missed (tab closed before redirect, webhook not configured, API restarting). This
   * sweeps entries that are still PENDING_PAYMENT despite having a payment reference and asks
   * Paystack directly whether each was paid, confirming any that were. It is the guarantee that
   * a paid registration never stays stranded — webhook/callback are just the fast path.
   *
   * Bounded to entries between 3 minutes and 24 hours old: newer than 3 min gives the fast path
   * a chance first; older than 24 h is treated as abandoned and no longer polled.
   */
  async reconcilePendingPayments(): Promise<{ checked: number; confirmed: number }> {
    const now = Date.now();
    const minAge = new Date(now - 3 * 60 * 1000);
    const maxAge = new Date(now - 24 * 60 * 60 * 1000);

    const stuck = await this.prisma.registrationEntry.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paystackReference: { not: null },
        createdAt: { lt: minAge, gt: maxAge },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, paystackReference: true },
    });

    let confirmed = 0;
    for (const e of stuck) {
      try {
        // handlePaymentConfirmed re-verifies with Paystack and only confirms genuinely-paid entries.
        const res = await this.handlePaymentConfirmed(e.paystackReference as string);
        if (res?.entry?.status === 'CONFIRMED' || res?.entry?.status === 'AWAITING_APPROVAL') confirmed++;
      } catch (err) {
        this.logger.warn(`Payment reconciliation failed for ${e.paystackReference}: ${String(err)}`);
      }
    }

    // Expire abandoned holds: an entry still PENDING_PAYMENT beyond the window is treated as
    // abandoned and CANCELLED, which frees its spot (capacity counts only non-cancelled entries).
    // By this age the 5-min reconcile has re-verified it many times, so it is genuinely unpaid.
    const expired = await this.prisma.registrationEntry.updateMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: maxAge } },
      data: { status: 'CANCELLED' },
    });

    if (stuck.length > 0 || expired.count > 0) {
      this.logger.log(`Payment reconciliation: checked ${stuck.length}, confirmed ${confirmed}, expired ${expired.count}`);
    }
    return { checked: stuck.length, confirmed };
  }

  async handlePaymentConfirmed(paystackReference: string): Promise<{ entry: any; product: any } | null> {
    // A reference covers ALL tickets bought in one purchase (a cart shares one reference; a single
    // registration is just a group of one). Confirm every entry under the reference together.
    const entries = await this.prisma.registrationEntry.findMany({
      where: { paystackReference },
      include: { product: true },
    });
    if (entries.length === 0) return null;

    const pending = entries.filter((e) => e.status === 'PENDING_PAYMENT');
    if (pending.length === 0) {
      // Idempotent: all already resolved. Return a confirmed one; never resurrect a cancelled group.
      const settled = entries.find((e) => e.status === 'CONFIRMED' || e.status === 'AWAITING_APPROVAL');
      if (settled) return { entry: settled, product: settled.product };
      this.logger.warn(`All entries for reference ${paystackReference} are cancelled — ignoring payment webhook.`);
      return null;
    }

    // Verify the transaction server-side with Paystack before confirming.
    const verification = await this.verifyPaystackTransaction(paystackReference);
    if (!verification || verification.data?.status !== 'success') {
      this.logger.warn(`Paystack server-side verification failed for reference ${paystackReference}`);
      return null;
    }
    if (verification.data.reference !== paystackReference) {
      this.logger.warn(`Reference mismatch in Paystack verification response for ${paystackReference}`);
      return null;
    }
    // Verify against the SUM charged across every ticket under this reference.
    // When the org has a subaccount, the payment was grossed up (fees added on top of ticket price)
    // so the organiser's settlement is protected — recompute the gross for the comparison.
    const totalTicketMinor = entries.reduce((sum, e) => sum + ((e.amountMinor && e.amountMinor > 0) ? e.amountMinor : (e.product.priceMinor ?? 0) * (e.quantity ?? 1)), 0);
    const orgSubaccount = await this.getOrgSubaccount(entries[0].orgId);
    const expectedAmount = orgSubaccount
      ? this.computeRegistrationGross(totalTicketMinor).gross
      : totalTicketMinor;
    if (verification.data.amount !== expectedAmount) {
      this.logger.warn(`Amount mismatch for ${paystackReference}: expected ${expectedAmount}, got ${verification.data.amount}`);
      return null;
    }

    // Confirm all still-pending entries atomically (status precondition dedups concurrent webhooks).
    // A group's tickets share one product, so they share the same post-payment status.
    const newStatus = pending[0].product.requiresApproval ? 'AWAITING_APPROVAL' : 'CONFIRMED';
    const pendingIds = pending.map((e) => e.id);
    const result = await this.prisma.registrationEntry.updateMany({
      where: { id: { in: pendingIds }, status: 'PENDING_PAYMENT' },
      data: { status: newStatus as any, paidAt: new Date() },
    });

    // Only the delivery that actually flipped them enqueues receipts — one ticket per attendee.
    if (result.count > 0) {
      for (const e of pending) await this.enqueueRegistrationReceipt(e.id, e.orgId);
    }

    const updated = await this.prisma.registrationEntry.findFirst({ where: { id: pending[0].id }, include: { product: true } });
    return updated ? { entry: updated, product: updated.product } : null;
  }

  private async verifyPaystackTransaction(reference: string): Promise<{ status: boolean; data: { status: string; amount: number; reference: string } } | null> {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) return null;
    try {
      const response = await firstValueFrom(
        this.http.get<{ status: boolean; data: { status: string; amount: number; reference: string } }>(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          { headers: { Authorization: `Bearer ${secret}` } },
        ),
      );
      return response.data ?? null;
    } catch (err) {
      this.logger.warn(`Paystack verify call failed for reference ${reference}: ${String(err)}`);
      return null;
    }
  }

  // ── Public ticket verification ───────────────────────────────────────────
  // No auth — deliberately returns only what's needed to display a ticket, nothing sensitive.

  /** Opaque, URL-safe single-use admission code embedded in the ticket QR. */
  private newCheckInCode(): string {
    return randomBytes(16).toString('base64url');
  }

  async getPublicTicket(entryId: string) {
    const entry = await this.prisma.registrationEntry.findUnique({
      where: { id: entryId },
      include: { product: true, ticketType: { select: { name: true } } },
    });
    if (!entry) throw new NotFoundException('Ticket not found');

    // Lazily mint a check-in code for older entries created before this feature.
    let checkInCode = entry.checkInCode;
    if (!checkInCode && entry.status === 'CONFIRMED') {
      checkInCode = this.newCheckInCode();
      await this.prisma.registrationEntry.update({ where: { id: entry.id }, data: { checkInCode } }).catch(() => { checkInCode = entry.checkInCode; });
    }

    // Only confirmed tickets are admittable — generate the scannable QR (as a data URL so the ticket
    // page needs no QR library) just for those.
    let qrDataUrl: string | null = null;
    if (entry.status === 'CONFIRMED' && checkInCode) {
      try {
        qrDataUrl = await QRCode.toDataURL(checkInCode, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
      } catch { qrDataUrl = null; }
    }

    return {
      eventName: entry.product.name,
      eventDate: entry.product.eventDate,
      venue: entry.product.venue ?? null,
      customerName: entry.customerName,
      ticketType: entry.ticketType?.name ?? null,
      status: entry.status,
      quantity: entry.quantity ?? 1,
      reference: (entry.paystackReference ?? entry.id).slice(-12).toUpperCase(),
      checkedInAt: entry.checkedInAt,
      qrDataUrl,
    };
  }

  /**
   * Scan-to-admit: verify a ticket QR's code and mark the entry checked in. Single-use — the
   * check-in is claimed atomically (updateMany on checkedInAt IS NULL), so a second scan of the same
   * ticket returns ALREADY_CHECKED_IN instead of admitting twice. Scoped to the caller's org.
   */
  async checkInByCode(orgId: string, code: string, productId?: string): Promise<{
    outcome: 'ADMITTED' | 'ALREADY_CHECKED_IN' | 'NOT_CONFIRMED' | 'NOT_FOUND' | 'WRONG_EVENT';
    entry?: { id: string; customerName: string | null; customerEmail: string | null; eventName: string; ticketType: string | null; quantity: number; checkedInAt: Date | null };
  }> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) return { outcome: 'NOT_FOUND' };

    const entry = await this.prisma.registrationEntry.findFirst({
      where: { checkInCode: trimmed, orgId },
      include: { product: { select: { name: true } }, ticketType: { select: { name: true } } },
    });
    if (!entry) return { outcome: 'NOT_FOUND' };

    const info = {
      id: entry.id,
      customerName: entry.customerName,
      customerEmail: entry.customerEmail,
      eventName: entry.product.name,
      ticketType: entry.ticketType?.name ?? null,
      quantity: entry.quantity ?? 1,
      checkedInAt: entry.checkedInAt,
    };

    // Per-event scoping: when the scanner is locked to an event, a valid ticket for a DIFFERENT
    // event is rejected (with its real event name) rather than admitted at the wrong door.
    if (productId && entry.productId !== productId) return { outcome: 'WRONG_EVENT', entry: info };
    if (entry.status !== 'CONFIRMED') return { outcome: 'NOT_CONFIRMED', entry: info };
    if (entry.checkedInAt) return { outcome: 'ALREADY_CHECKED_IN', entry: info };

    // Atomic claim: only the row that is still un-checked-in flips, so concurrent scans can't both win.
    const now = new Date();
    const claimed = await this.prisma.registrationEntry.updateMany({
      where: { id: entry.id, checkedInAt: null },
      data: { checkedInAt: now },
    });
    if (claimed.count === 0) {
      const fresh = await this.prisma.registrationEntry.findUnique({ where: { id: entry.id }, select: { checkedInAt: true } });
      return { outcome: 'ALREADY_CHECKED_IN', entry: { ...info, checkedInAt: fresh?.checkedInAt ?? entry.checkedInAt } };
    }
    // Live: push the admission to any dashboard viewing this event.
    try {
      this.events.emitRegistrationCheckIn(orgId, { productId: entry.productId, entryId: entry.id, checkedInAt: now, customerName: entry.customerName });
    } catch { /* non-fatal */ }
    return { outcome: 'ADMITTED', entry: { ...info, checkedInAt: now } };
  }

  /**
   * Manual door check-in from the dashboard's list (the fallback when a QR won't scan): admit — or
   * un-admit (undo) — a specific entry by id. Same single-use atomic claim as the QR path, and emits
   * the same live event so every open Check-in view updates instantly.
   */
  async setEntryCheckIn(orgId: string, entryId: string, admit: boolean): Promise<{
    outcome: 'ADMITTED' | 'UNDONE' | 'ALREADY_CHECKED_IN' | 'NOT_CHECKED_IN' | 'NOT_CONFIRMED' | 'NOT_FOUND';
    entry?: { id: string; customerName: string | null; ticketType: string | null; checkedInAt: Date | null };
  }> {
    const entry = await this.prisma.registrationEntry.findFirst({
      where: { id: entryId, orgId },
      include: { ticketType: { select: { name: true } } },
    });
    if (!entry) return { outcome: 'NOT_FOUND' };
    const base = { id: entry.id, customerName: entry.customerName, ticketType: entry.ticketType?.name ?? null };

    if (admit) {
      if (entry.status !== 'CONFIRMED') return { outcome: 'NOT_CONFIRMED', entry: { ...base, checkedInAt: entry.checkedInAt } };
      if (entry.checkedInAt) return { outcome: 'ALREADY_CHECKED_IN', entry: { ...base, checkedInAt: entry.checkedInAt } };
      const now = new Date();
      const claimed = await this.prisma.registrationEntry.updateMany({ where: { id: entry.id, checkedInAt: null }, data: { checkedInAt: now } });
      if (claimed.count === 0) {
        const fresh = await this.prisma.registrationEntry.findUnique({ where: { id: entry.id }, select: { checkedInAt: true } });
        return { outcome: 'ALREADY_CHECKED_IN', entry: { ...base, checkedInAt: fresh?.checkedInAt ?? entry.checkedInAt } };
      }
      try { this.events.emitRegistrationCheckIn(orgId, { productId: entry.productId, entryId: entry.id, checkedInAt: now, customerName: entry.customerName }); } catch { /* non-fatal */ }
      return { outcome: 'ADMITTED', entry: { ...base, checkedInAt: now } };
    }

    // Undo an admission (e.g. wrong person tapped in).
    if (!entry.checkedInAt) return { outcome: 'NOT_CHECKED_IN', entry: { ...base, checkedInAt: null } };
    await this.prisma.registrationEntry.update({ where: { id: entry.id }, data: { checkedInAt: null } });
    try { this.events.emitRegistrationCheckIn(orgId, { productId: entry.productId, entryId: entry.id, checkedInAt: null, customerName: entry.customerName }); } catch { /* non-fatal */ }
    return { outcome: 'UNDONE', entry: { ...base, checkedInAt: null } };
  }

  // ── Scan sessions (temporary public, event-scoped check-in links) ─────────────
  // A shareable URL that lets door/volunteer staff scan or type ticket codes to admit attendees for
  // ONE event, with no account. The token is a bearer credential, so the surface is deliberately
  // narrow: single event, expiring, revocable, admit-only, minimal PII, no browsable roster.

  private scanSessionStatus(s: { expiresAt: Date; revokedAt: Date | null }): 'active' | 'expired' | 'revoked' {
    if (s.revokedAt) return 'revoked';
    if (s.expiresAt.getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  /** OWNER/ADMIN: mint a scan-session link for an event. Default expiry = event end + 6h (or +24h if
   * the event has no date); an explicit expiresAt overrides. */
  async createScanSession(orgId: string, productId: string, createdBy: string | null, input: { label?: string; expiresAt?: string }) {
    const prismaAny = this.prisma as any;
    const product = await prismaAny.registrationProduct.findFirst({ where: { id: productId, orgId }, select: { id: true, name: true, eventDate: true } });
    if (!product) throw new NotFoundException('Event not found');

    let expiresAt: Date;
    if (input.expiresAt) {
      expiresAt = new Date(input.expiresAt);
      if (isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new BadRequestException('Expiry must be a valid future date/time.');
    } else {
      expiresAt = product.eventDate ? new Date(new Date(product.eventDate).getTime() + 6 * 3600_000) : new Date(Date.now() + 24 * 3600_000);
      if (expiresAt.getTime() <= Date.now()) expiresAt = new Date(Date.now() + 6 * 3600_000); // past-dated event → short window from now
    }

    const token = randomBytes(24).toString('hex');
    const session = await prismaAny.eventScanSession.create({
      data: { orgId, productId, token, label: input.label?.trim() || null, expiresAt, createdBy: createdBy ?? null },
    });
    return { id: session.id, token, label: session.label, expiresAt: session.expiresAt, url: `${this.getPublicAppUrl()}/scan/${token}`, status: 'active' as const };
  }

  /** OWNER/ADMIN: list an event's sessions (newest first) with status + shareable URL. */
  async listScanSessions(orgId: string, productId: string) {
    const prismaAny = this.prisma as any;
    const sessions = await prismaAny.eventScanSession.findMany({ where: { orgId, productId }, orderBy: { createdAt: 'desc' } });
    const appUrl = this.getPublicAppUrl();
    return sessions.map((s: any) => ({
      id: s.id, label: s.label, expiresAt: s.expiresAt, revokedAt: s.revokedAt, createdAt: s.createdAt,
      status: this.scanSessionStatus(s), url: `${appUrl}/scan/${s.token}`,
    }));
  }

  /** OWNER/ADMIN: kill a session immediately (leak response). Idempotent. */
  async revokeScanSession(orgId: string, sessionId: string) {
    const prismaAny = this.prisma as any;
    const session = await prismaAny.eventScanSession.findFirst({ where: { id: sessionId, orgId }, select: { id: true, revokedAt: true } });
    if (!session) throw new NotFoundException('Scan session not found');
    if (!session.revokedAt) await prismaAny.eventScanSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  /** Public: validate a token and return the minimal event context the scan page needs. */
  async resolveScanSession(token: string): Promise<
    | { valid: false; reason: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' }
    | { valid: true; productId: string; orgId: string; eventName: string; venue: string | null; eventDate: Date | null; label: string | null; expiresAt: Date }
  > {
    const prismaAny = this.prisma as any;
    const s = await prismaAny.eventScanSession.findUnique({ where: { token: (token ?? '').trim() }, include: { product: { select: { id: true, name: true, venue: true, eventDate: true } } } });
    if (!s || !s.product) return { valid: false, reason: 'NOT_FOUND' };
    if (s.revokedAt) return { valid: false, reason: 'REVOKED' };
    if (s.expiresAt.getTime() <= Date.now()) return { valid: false, reason: 'EXPIRED' };
    return { valid: true, productId: s.productId, orgId: s.orgId, eventName: s.product.name, venue: s.product.venue, eventDate: s.product.eventDate, label: s.label, expiresAt: s.expiresAt };
  }

  /** Public: admit a ticket through a scan session. Reuses the event-locked check-in, then strips
   * email so the anonymous page only ever sees name + tier + status — never the full contact/PII. */
  async scanSessionCheckIn(token: string, code: string): Promise<{
    outcome: 'ADMITTED' | 'ALREADY_CHECKED_IN' | 'NOT_CONFIRMED' | 'NOT_FOUND' | 'WRONG_EVENT' | 'SESSION_INVALID';
    reason?: string;
    entry?: { customerName: string | null; ticketType: string | null; checkedInAt: Date | null };
  }> {
    const resolved = await this.resolveScanSession(token);
    if (!resolved.valid) return { outcome: 'SESSION_INVALID', reason: resolved.reason };
    const res = await this.checkInByCode(resolved.orgId, code, resolved.productId);
    // Only surface attendee details for tickets that belong to THIS event; a WRONG_EVENT/NOT_FOUND
    // ticket gets no name (minimal PII — the session has no business revealing another event's people).
    const showEntry = res.outcome === 'ADMITTED' || res.outcome === 'ALREADY_CHECKED_IN' || res.outcome === 'NOT_CONFIRMED';
    const entry = showEntry && res.entry ? { customerName: res.entry.customerName, ticketType: res.entry.ticketType, checkedInAt: res.entry.checkedInAt } : undefined;
    return { outcome: res.outcome, entry };
  }

  // ── Attendee announcements (transactional email to an event's registrants) ───

  private announcementSegmentWhere(productId: string, segment: string, tierId?: string | null): Record<string, unknown> {
    switch (segment) {
      case 'CONFIRMED': return { productId, status: 'CONFIRMED' };
      case 'PENDING': return { productId, status: 'PENDING_PAYMENT' };
      case 'CHECKED_IN': return { productId, status: 'CONFIRMED', checkedInAt: { not: null } };
      case 'TIER': return { productId, status: { not: 'CANCELLED' }, ...(tierId ? { ticketTypeId: tierId } : {}) };
      case 'ALL':
      default: return { productId, status: { not: 'CANCELLED' } };
    }
  }

  /** Distinct-email recipient counts per audience, for the compose UI's live count. */
  async announcementRecipientCounts(orgId: string, productId: string) {
    const prismaAny = this.prisma as any;
    const product = await prismaAny.registrationProduct.findFirst({ where: { id: productId, orgId }, select: { id: true } });
    if (!product) throw new NotFoundException('Event not found');
    const rows = await prismaAny.registrationEntry.findMany({
      where: { productId, status: { not: 'CANCELLED' } },
      select: { customerEmail: true, status: true, checkedInAt: true, ticketTypeId: true },
    });
    const uniq = (arr: any[]) => new Set(arr.map((r) => (r.customerEmail ?? '').trim().toLowerCase()).filter(Boolean)).size;
    const tiers = await prismaAny.registrationTicketType.findMany({ where: { productId, isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return {
      all: uniq(rows),
      confirmed: uniq(rows.filter((r: any) => r.status === 'CONFIRMED')),
      pending: uniq(rows.filter((r: any) => r.status === 'PENDING_PAYMENT')),
      checkedIn: uniq(rows.filter((r: any) => r.checkedInAt)),
      tiers: tiers.map((t: any) => ({ id: t.id, name: t.name, count: uniq(rows.filter((r: any) => r.ticketTypeId === t.id)) })),
    };
  }

  /** OWNER/ADMIN: send a transactional announcement to an audience of an event's attendees. Resolves
   * + dedupes recipients by email, records it, and enqueues one worker job per recipient. */
  async createAnnouncement(orgId: string, productId: string, sentBy: string | null, dto: { segment: string; tierId?: string; subject: string; body: string }): Promise<
    { outcome: 'QUEUED'; id: string; totalRecipients: number } | { outcome: 'NO_RECIPIENTS'; message: string }
  > {
    const prismaAny = this.prisma as any;
    const product = await prismaAny.registrationProduct.findFirst({ where: { id: productId, orgId }, select: { id: true, name: true, organization: { select: { name: true } } } });
    if (!product) throw new NotFoundException('Event not found');

    const entries = await prismaAny.registrationEntry.findMany({
      where: this.announcementSegmentWhere(productId, dto.segment, dto.tierId),
      select: { customerEmail: true, customerName: true },
    });
    // Dedupe by email — a buyer holding several tickets is one recipient.
    const byEmail = new Map<string, string | null>();
    for (const e of entries) {
      const em = (e.customerEmail ?? '').trim().toLowerCase();
      if (em && !byEmail.has(em)) byEmail.set(em, e.customerName ?? null);
    }
    if (byEmail.size === 0) return { outcome: 'NO_RECIPIENTS', message: 'No attendees match that audience.' };

    const ann = await prismaAny.eventAnnouncement.create({
      data: { orgId, productId, subject: dto.subject, body: dto.body, segment: dto.segment, tierId: dto.tierId ?? null, totalRecipients: byEmail.size, sentBy: sentBy ?? null },
    });
    const orgName = product.organization?.name ?? null;
    for (const [email] of byEmail) {
      await this.receiptsQueue.add(
        RECEIPT_JOB.ANNOUNCEMENT,
        { announcementId: ann.id, orgId, to: email, subject: dto.subject, body: dto.body, eventName: product.name, orgName },
        RECEIPT_JOB_OPTIONS,
      ).catch((err) => this.logger.error(`Failed to enqueue announcement job for ${email}: ${String(err)}`));
    }
    return { outcome: 'QUEUED', id: ann.id, totalRecipients: byEmail.size };
  }

  /** OWNER/ADMIN: the Messages history for an event (newest first). */
  async listAnnouncements(orgId: string, productId: string) {
    const prismaAny = this.prisma as any;
    return prismaAny.eventAnnouncement.findMany({ where: { orgId, productId }, orderBy: { createdAt: 'desc' } });
  }

  // ── Automatic reminders (periodic sweep) ──────────────────────────────────────
  // One idempotent sweep sends the opt-in transactional reminders: a pre-event reminder to confirmed
  // attendees, and a nudge to registrants who haven't paid. Each recipient is marked per reminder
  // type so a re-run never double-sends. Reuses the announcement worker + Messages history (flagged
  // `automated`). Called from the scheduler.

  async sendDueReminders(): Promise<void> {
    await this.sendPreEventReminders().catch((e) => this.logger.warn(`Pre-event reminder sweep failed: ${String(e)}`));
    await this.sendUnpaidNudges().catch((e) => this.logger.warn(`Unpaid-nudge sweep failed: ${String(e)}`));
  }

  /** Shared: create an automated announcement record, enqueue a job per unique recipient, and mark
   * every matched entry so the next sweep skips them. Returns how many recipients were queued. */
  private async dispatchReminder(
    product: { id: string; orgId: string; name: string; organization?: { name: string | null } | null },
    entries: Array<{ id: string; customerName: string | null; customerEmail: string | null; paystackAccessCode?: string | null }>,
    reminderType: string, segment: string, subject: string, bodyFor: (e: any) => string,
  ): Promise<number> {
    const prismaAny = this.prisma as any;
    const byEmail = new Map<string, string>();
    for (const e of entries) {
      const em = (e.customerEmail ?? '').trim().toLowerCase();
      if (em && !byEmail.has(em)) byEmail.set(em, bodyFor(e));
    }
    if (byEmail.size === 0) return 0;

    const ann = await prismaAny.eventAnnouncement.create({
      data: { orgId: product.orgId, productId: product.id, subject, body: '(automated reminder)', segment, automated: true, totalRecipients: byEmail.size },
    });
    const orgName = product.organization?.name ?? null;
    for (const [email, body] of byEmail) {
      // Reuse the announcement worker + delivery tally.
      await this.receiptsQueue.add(
        RECEIPT_JOB.ANNOUNCEMENT,
        { announcementId: ann.id, orgId: product.orgId, to: email, subject, body, eventName: product.name, orgName },
        RECEIPT_JOB_OPTIONS,
      ).catch((err) => this.logger.error(`Failed to enqueue reminder for ${email}: ${String(err)}`));
    }
    // Mark every matched entry (not just the deduped emails) so none re-trigger next sweep.
    await prismaAny.registrationEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) } }, data: { remindersSent: { push: reminderType } } });
    return byEmail.size;
  }

  private async sendPreEventReminders(): Promise<void> {
    const prismaAny = this.prisma as any;
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * 3600_000);
    const products = await prismaAny.registrationProduct.findMany({
      where: { reminderBeforeEvent: true, isActive: true, eventDate: { gte: now, lte: soon } },
      include: { organization: { select: { name: true } } },
    });
    for (const product of products) {
      const entries = await prismaAny.registrationEntry.findMany({
        where: { productId: product.id, status: 'CONFIRMED', checkedInAt: null, customerEmail: { not: null }, NOT: { remindersSent: { has: 'BEFORE_EVENT' } } },
        select: { id: true, customerName: true, customerEmail: true },
      });
      if (!entries.length) continue;
      const dateStr = product.eventDate ? new Date(product.eventDate).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' }) : 'soon';
      const first = (n: string | null) => (n ? ` ${n.split(' ')[0]}` : '');
      await this.dispatchReminder(product, entries, 'BEFORE_EVENT', 'CONFIRMED', `Reminder: ${product.name} is coming up`,
        (e) => `Hi${first(e.customerName)},\n\nJust a reminder that ${product.name} is happening ${dateStr}${product.venue ? ` at ${product.venue}` : ''}. Bring your ticket QR for a quick check-in.\n\nSee you there!`);
      this.logger.log(`Pre-event reminder queued for ${entries.length} attendee(s) of "${product.name}"`);
    }
  }

  private async sendUnpaidNudges(): Promise<void> {
    const prismaAny = this.prisma as any;
    const cutoff = new Date(Date.now() - 12 * 3600_000);
    const appUrl = this.getPublicAppUrl();
    const products = await prismaAny.registrationProduct.findMany({
      where: { reminderUnpaidNudge: true, isActive: true },
      include: { organization: { select: { name: true } } },
    });
    for (const product of products) {
      const entries = await prismaAny.registrationEntry.findMany({
        where: { productId: product.id, status: 'PENDING_PAYMENT', createdAt: { lt: cutoff }, customerEmail: { not: null }, NOT: { remindersSent: { has: 'UNPAID_NUDGE' } } },
        select: { id: true, customerName: true, customerEmail: true, paystackAccessCode: true },
      });
      if (!entries.length) continue;
      const first = (n: string | null) => (n ? ` ${n.split(' ')[0]}` : '');
      await this.dispatchReminder(product, entries, 'UNPAID_NUDGE', 'PENDING', `Complete your registration for ${product.name}`,
        (e) => {
          const link = e.paystackAccessCode ? `https://checkout.paystack.com/${e.paystackAccessCode}` : `${appUrl}/ticket/${e.id}`;
          return `Hi${first(e.customerName)},\n\nYou registered for ${product.name} but your payment isn't complete yet — your spot isn't secured until it is.\n\nComplete it here: ${link}\n\nSee you there!`;
        });
      this.logger.log(`Unpaid nudge queued for ${entries.length} registrant(s) of "${product.name}"`);
    }
  }

  // ── Dead letter queue (failed receipt jobs) ──────────────────────────────
  // Scoped per-org: job payloads always carry orgId, so we filter to the caller's org.

  async listFailedReceiptJobs(orgId: string) {
    const jobs = await this.receiptsQueue.getFailed(0, 500);
    return jobs
      .filter((job) => job.data?.orgId === orgId)
      .map((job) => ({
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
      }));
  }

  private async getOwnedFailedJob(orgId: string, jobId: string) {
    const job = await this.receiptsQueue.getJob(jobId);
    if (!job || job.data?.orgId !== orgId) throw new NotFoundException('Job not found');
    return job;
  }

  async retryFailedReceiptJob(orgId: string, jobId: string) {
    const job = await this.getOwnedFailedJob(orgId, jobId);
    await job.retry();
    return { retried: true };
  }

  async discardFailedReceiptJob(orgId: string, jobId: string) {
    const job = await this.getOwnedFailedJob(orgId, jobId);
    await job.remove();
    return { discarded: true };
  }
}
