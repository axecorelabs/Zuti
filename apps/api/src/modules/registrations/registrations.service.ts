import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPTS_QUEUE } from '../queue/queue.module';
import { RECEIPT_JOB, RECEIPT_JOB_OPTIONS } from '../queue/receipts.processor';
import { CreateRegistrationProductDto, UpdateRegistrationProductDto, UpdateRegistrationEntryDto } from './dto/registrations.dto';

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
    @InjectQueue(RECEIPTS_QUEUE) private readonly receiptsQueue: Queue,
  ) {}

  // ── Products ──────────────────────────────────────────────────────────────

  async createProduct(orgId: string, dto: CreateRegistrationProductDto) {
    if (dto.botId) {
      const bot = await this.prisma.bot.findFirst({ where: { id: dto.botId, organizationId: orgId }, select: { id: true } });
      if (!bot) throw new NotFoundException('Bot not found');
    }
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
        confirmationMessage: dto.confirmationMessage ?? null,
        fields: (dto.fields ?? []) as any,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async listProducts(orgId: string, botId?: string) {
    return this.prisma.registrationProduct.findMany({
      where: { orgId, ...(botId ? { botId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
  }

  async getProduct(orgId: string, productId: string) {
    const product = await this.prisma.registrationProduct.findFirst({
      where: { id: productId, orgId },
      include: { _count: { select: { entries: true } } },
    });
    if (!product) throw new NotFoundException('Registration product not found');
    return product;
  }

  async updateProduct(orgId: string, productId: string, dto: UpdateRegistrationProductDto) {
    const existing = await this.prisma.registrationProduct.findFirst({ where: { id: productId, orgId } });
    if (!existing) throw new NotFoundException('Registration product not found');
    if (dto.botId !== undefined && dto.botId) {
      const bot = await this.prisma.bot.findFirst({ where: { id: dto.botId, organizationId: orgId }, select: { id: true } });
      if (!bot) throw new NotFoundException('Bot not found');
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
        ...(dto.confirmationMessage !== undefined && { confirmationMessage: dto.confirmationMessage }),
        ...(dto.fields !== undefined && { fields: dto.fields as any }),
        ...(dto.botId !== undefined && { botId: dto.botId || null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { _count: { select: { entries: true } } },
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

  async getEntryCount(productId: string): Promise<number> {
    return this.prisma.registrationEntry.count({ where: { productId, status: { not: 'CANCELLED' } } });
  }

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
  }) {
    const status = data.isFree
      ? (data.requiresApproval ? 'AWAITING_APPROVAL' : 'CONFIRMED')
      : 'PENDING_PAYMENT';

    const entry = await this.prisma.registrationEntry.create({
      data: {
        productId: data.productId,
        orgId: data.orgId,
        botId: data.botId ?? null,
        conversationId: data.conversationId ?? null,
        actionTaskId: data.actionTaskId ?? null,
        customerName: data.customerName ?? null,
        customerEmail: data.customerEmail ?? null,
        collectedFields: data.collectedFields as any,
        status: status as any,
      },
      include: { product: true },
    });

    // Free events skip payment entirely — send the ticket (no receipt) as soon as the entry is confirmed
    if (data.isFree && (status === 'CONFIRMED' || status === 'AWAITING_APPROVAL')) {
      await this.enqueueRegistrationReceipt(entry.id, data.orgId);
    }

    return entry;
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

  // ── Paystack ──────────────────────────────────────────────────────────────

  async initializePayment(entryId: string, orgId: string): Promise<{ paymentUrl: string; reference: string }> {
    const entry = await this.prisma.registrationEntry.findFirst({
      where: { id: entryId, orgId },
      include: { product: true },
    });
    if (!entry) throw new NotFoundException('Registration entry not found');
    if (entry.product.isFree) throw new BadRequestException('Product is free — no payment needed');
    if (!entry.customerEmail) throw new BadRequestException('Customer email is required for payment');
    if (entry.status !== 'PENDING_PAYMENT') throw new BadRequestException('Entry is not awaiting payment');

    // Idempotency: if already initialized, reconstruct the checkout URL from the stored access code
    if (entry.paystackReference && entry.paystackAccessCode) {
      return {
        paymentUrl: `https://checkout.paystack.com/${entry.paystackAccessCode}`,
        reference: entry.paystackReference,
      };
    }

    const paystackSecret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');

    // Use pure random bytes — no timestamp to avoid millisecond collisions
    const reference = `zuti_reg_${randomBytes(16).toString('hex')}`;
    const response = await firstValueFrom(
      this.http.post<PaystackInitResponse>('https://api.paystack.co/transaction/initialize', {
        amount: entry.product.priceMinor,
        email: entry.customerEmail,
        currency: entry.product.currency,
        reference,
        metadata: {
          organizationId: orgId,
          registrationEntryId: entry.id,
          registrationProductId: entry.productId,
          source: 'zuti-registration',
        },
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

    return { paymentUrl: response.data.data.authorization_url, reference: response.data.data.reference };
  }

  async handlePaymentConfirmed(paystackReference: string): Promise<{ entry: any; product: any } | null> {
    const entry = await this.prisma.registrationEntry.findFirst({
      where: { paystackReference },
      include: { product: true },
    });
    if (!entry) return null;

    // Idempotent: already in a terminal post-payment state
    if (entry.status === 'CONFIRMED' || entry.status === 'AWAITING_APPROVAL') {
      return { entry, product: entry.product };
    }
    // Never resurrect a cancelled entry via a payment webhook replay
    if (entry.status === 'CANCELLED') {
      this.logger.warn(`Registration entry ${entry.id} is CANCELLED — ignoring payment webhook for reference ${paystackReference}`);
      return null;
    }

    // Verify the transaction server-side with Paystack before confirming
    const verification = await this.verifyPaystackTransaction(paystackReference);
    if (!verification || verification.data?.status !== 'success') {
      this.logger.warn(`Paystack server-side verification failed for reference ${paystackReference}`);
      return null;
    }
    if (verification.data.reference !== paystackReference) {
      this.logger.warn(`Reference mismatch in Paystack verification response for ${paystackReference}`);
      return null;
    }
    if (verification.data.amount !== entry.product.priceMinor) {
      this.logger.warn(`Amount mismatch for ${paystackReference}: expected ${entry.product.priceMinor}, got ${verification.data.amount}`);
      return null;
    }

    const newStatus = entry.product.requiresApproval ? 'AWAITING_APPROVAL' : 'CONFIRMED';

    // Atomic update with status precondition — prevents double-confirmation under concurrent webhook delivery
    const result = await this.prisma.registrationEntry.updateMany({
      where: { id: entry.id, status: 'PENDING_PAYMENT' },
      data: { status: newStatus as any, paidAt: new Date() },
    });

    if (result.count === 0) {
      // Another webhook delivery won the race — re-fetch and return current state
      const current = await this.prisma.registrationEntry.findFirst({ where: { id: entry.id }, include: { product: true } });
      return current ? { entry: current, product: current.product } : null;
    }

    // This delivery won the race — it is the only one that enqueues the receipt job
    await this.enqueueRegistrationReceipt(entry.id, entry.orgId);

    const updated = await this.prisma.registrationEntry.findFirst({ where: { id: entry.id }, include: { product: true } });
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

  // ── Capacity check ────────────────────────────────────────────────────────

  async isAtCapacity(productId: string, capacity: number | null): Promise<boolean> {
    if (capacity === null) return false;
    const count = await this.getEntryCount(productId);
    return count >= capacity;
  }

  // ── Public ticket verification ───────────────────────────────────────────
  // No auth — deliberately returns only what's needed to display a ticket, nothing sensitive.

  async getPublicTicket(entryId: string) {
    const entry = await this.prisma.registrationEntry.findUnique({
      where: { id: entryId },
      include: { product: true },
    });
    if (!entry) throw new NotFoundException('Ticket not found');
    return {
      eventName: entry.product.name,
      eventDate: entry.product.eventDate,
      customerName: entry.customerName,
      status: entry.status,
      reference: (entry.paystackReference ?? entry.id).slice(-12).toUpperCase(),
    };
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
