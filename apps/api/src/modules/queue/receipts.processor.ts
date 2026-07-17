import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as QRCode from 'qrcode';
import { RECEIPTS_QUEUE } from './queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { sendWhatsAppText } from '../../common/utils/whatsapp';

// ── Job payloads ──────────────────────────────────────────────────────────────

export interface RegistrationReceiptJobPayload {
  entryId: string;
  orgId: string;
}

export interface CreditsReceiptJobPayload {
  transactionId: string;
  orgId: string;
}

export interface EcommerceReceiptJobPayload {
  orderId: string;
  orgId: string;
}

export const RECEIPT_JOB = {
  REGISTRATION: 'registration',
  CREDITS: 'credits',
  ECOMMERCE: 'ecommerce',
} as const;

// Default job options used everywhere receipts are enqueued
export const RECEIPT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 200,
  removeOnFail: false, // keep ALL failed jobs — DLQ reads these
};

// ── Processor ─────────────────────────────────────────────────────────────────

@Processor(RECEIPTS_QUEUE)
export class ReceiptsProcessor {
  private readonly logger = new Logger(ReceiptsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  // ── Registration: ticket + receipt + channel message ──────────────────────

  @Process(RECEIPT_JOB.REGISTRATION)
  async handleRegistration(job: Job<RegistrationReceiptJobPayload>) {
    const { entryId, orgId } = job.data;
    const prismaAny = this.prisma as any;

    const entry = await prismaAny.registrationEntry.findFirst({
      where: { id: entryId, orgId },
      include: { product: true },
    });

    if (!entry) {
      this.logger.warn(`Receipt job ${job.id}: entry ${entryId} not found — discarding`);
      return;
    }
    if (entry.status === 'CANCELLED') {
      // Entry was cancelled after this job was enqueued (e.g. staff rejected it while a
      // retry was pending) — sending a ticket/receipt for a cancelled entry would be wrong.
      this.logger.warn(`Receipt job ${job.id}: entry ${entryId} is now CANCELLED — discarding`);
      return;
    }
    if (!entry.customerEmail) {
      this.logger.warn(`Receipt job ${job.id}: entry ${entryId} has no email — discarding`);
      return;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });

    const brand = this.getBrand();
    const appUrl = this.getAppUrl();
    const ticketUrl = `${appUrl}/ticket/${entryId}`;

    // Generate QR code — white bg so it's scannable in any email client
    const qrDataUrl = await QRCode.toDataURL(ticketUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    const eventDate = entry.product.eventDate
      ? new Date(entry.product.eventDate).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric',
        })
      : null;

    const reference = entry.paystackReference ?? entryId;
    const receiptNumber = `REC-${reference.slice(-8).toUpperCase()}`;

    // 1. Event ticket email
    await this.mail.sendEventTicket({
      to: entry.customerEmail,
      customerName: entry.customerName,
      eventName: entry.product.name,
      eventDate,
      reference,
      status: entry.status as 'CONFIRMED' | 'AWAITING_APPROVAL',
      qrDataUrl,
      ticketUrl,
      ...brand,
    });

    // 2. Payment receipt email — only when an actual payment was made
    if (!entry.product.isFree) {
      await this.mail.sendPaymentReceipt({
        to: entry.customerEmail,
        recipientName: entry.customerName,
        receiptNumber,
        description: `${entry.product.name} — Event Registration`,
        lineItems: [{
          label: entry.product.name,
          amountMinor: entry.product.priceMinor ?? 0,
          currency: entry.product.currency ?? 'NGN',
        }],
        totalMinor: entry.product.priceMinor ?? 0,
        currency: entry.product.currency ?? 'NGN',
        reference,
        paidAt: entry.paidAt ?? new Date(),
        companyName: org?.name ?? brand.appName,
        companyId: orgId,
        ...brand,
      });
    }

    // 3. Channel confirmation message (best-effort — failure does NOT retry the job)
    try {
      await this.sendChannelConfirmation(entry, reference, appUrl);
    } catch (err) {
      this.logger.warn(`Receipt job ${job.id}: channel message failed (non-fatal): ${String(err)}`);
    }

    this.logger.log(`Receipt job ${job.id}: ticket + receipt sent to ${entry.customerEmail}`);
  }

  // ── Credits receipt — sent to the purchasing user on behalf of the company ─

  @Process(RECEIPT_JOB.CREDITS)
  async handleCredits(job: Job<CreditsReceiptJobPayload>) {
    const { transactionId, orgId } = job.data;

    const transaction = await this.prisma.billingTransaction.findFirst({
      where: { id: transactionId, organizationId: orgId },
      include: { initiatedBy: true },
    });

    if (!transaction) {
      this.logger.warn(`Receipt job ${job.id}: billing transaction ${transactionId} not found — discarding`);
      return;
    }

    // Manual purchases have initiatedBy; automated commitment renewals carry the
    // original payer's email in metadata instead (system-initiated, no live user session).
    const metaEmail = (transaction.metadata as Record<string, unknown> | null)?.customerEmail;
    const recipientEmail = transaction.initiatedBy?.email ?? (typeof metaEmail === 'string' ? metaEmail : null);
    if (!recipientEmail) {
      this.logger.warn(`Receipt job ${job.id}: transaction ${transactionId} has no recipient email — discarding`);
      return;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });

    const brand = this.getBrand();
    const receiptNumber = `REC-${transaction.reference.slice(-8).toUpperCase()}`;
    const isCommitment = transaction.kind === 'COMMITMENT';
    const description = isCommitment ? 'Monthly Prepaid Commitment' : 'Credit Pack Purchase';

    await this.mail.sendPaymentReceipt({
      to: recipientEmail,
      recipientName: transaction.initiatedBy?.name ?? null,
      receiptNumber,
      description: `${org?.name ?? brand.appName} — ${description}`,
      lineItems: [{
        label: `${description} (${transaction.creditsUnits.toLocaleString()} credit units)`,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
      }],
      totalMinor: transaction.amountMinor,
      currency: transaction.currency,
      reference: transaction.reference,
      paidAt: transaction.paidAt ?? new Date(),
      companyName: org?.name ?? brand.appName,
      companyId: orgId,
      ...brand,
    });

    this.logger.log(`Receipt job ${job.id}: credits receipt sent to ${recipientEmail}`);
  }

  // ── Ecommerce receipt — sent to the customer who placed the order ─────────

  @Process(RECEIPT_JOB.ECOMMERCE)
  async handleEcommerce(job: Job<EcommerceReceiptJobPayload>) {
    const { orderId, orgId } = job.data;

    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: orderId, organizationId: orgId },
      include: {
        items: true,
        store: true,
        payments: { where: { status: 'SUCCESS' }, orderBy: { paidAt: 'desc' }, take: 1 },
      },
    });

    if (!order) {
      this.logger.warn(`Receipt job ${job.id}: commerce order ${orderId} not found — discarding`);
      return;
    }
    if (!order.customerEmail) {
      this.logger.warn(`Receipt job ${job.id}: order ${orderId} has no customer email — discarding`);
      return;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });

    const brand = this.getBrand();
    const payment = order.payments[0];
    const reference = payment?.reference ?? orderId;
    const receiptNumber = `REC-${reference.slice(-8).toUpperCase()}`;

    const lineItems = order.items.map((item) => ({
      label: item.quantity > 1 ? `${item.lineDescription ?? 'Item'} × ${item.quantity}` : (item.lineDescription ?? 'Item'),
      amountMinor: item.lineTotalMinor,
      currency: order.currency,
    }));

    await this.mail.sendPaymentReceipt({
      to: order.customerEmail,
      recipientName: order.customerName,
      receiptNumber,
      description: `${order.store.name} — Order Receipt`,
      lineItems,
      totalMinor: order.totalMinor,
      currency: order.currency,
      reference,
      paidAt: payment?.paidAt ?? new Date(),
      companyName: org?.name ?? brand.appName,
      companyId: orgId,
      ...brand,
    });

    this.logger.log(`Receipt job ${job.id}: ecommerce receipt sent to ${order.customerEmail}`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getBrand() {
    return {
      appName: this.config.get<string>('MAIL_BRAND_NAME') ?? 'Zuti',
      brandFooter: this.config.get<string>('MAIL_BRAND_FOOTER') ?? '© 2026 axecorelabs',
      primaryHex: this.config.get<string>('MAIL_BRAND_PRIMARY') ?? '#2563eb',
    };
  }

  private getAppUrl(): string {
    return (
      this.config.get<string>('NEXT_PUBLIC_APP_URL') ??
      this.config.get<string>('APP_URL') ??
      'https://app.zuti.bords.app'
    ).replace(/\/$/, '');
  }

  private async sendChannelConfirmation(entry: any, reference: string, appUrl: string) {
    if (!entry.conversationId) return;

    const prismaAny = this.prisma as any;
    const conv = await prismaAny.conversation.findUnique({
      where: { id: entry.conversationId },
      select: { channel: true, telegramChatId: true, whatsappPhoneNumber: true },
    });
    if (!conv) return;

    const bot = entry.botId
      ? await prismaAny.bot.findUnique({
          where: { id: entry.botId },
          select: {
            telegramToken: true,
            whatsappProvider: true,
            whatsappChannelIdentifier: true,
            whatsappConfig: true,
          },
        })
      : null;
    if (!bot) return;

    const msg =
      `Your registration is confirmed! 🎉\n\n` +
      `Your ticket and payment receipt have been sent to ${entry.customerEmail}.\n\n` +
      `Ref: ${reference.slice(-8).toUpperCase()}\n` +
      `View ticket: ${appUrl}/ticket/${entry.id}`;

    if (conv.channel === 'TELEGRAM' && conv.telegramChatId && bot.telegramToken) {
      await firstValueFrom(
        this.http.post(
          `https://api.telegram.org/bot${bot.telegramToken}/sendMessage`,
          { chat_id: conv.telegramChatId, text: msg },
        ),
      );
    } else if (conv.channel === 'WHATSAPP' && conv.whatsappPhoneNumber) {
      await sendWhatsAppText(
        this.http,
        {
          provider: bot.whatsappProvider,
          channelIdentifier: bot.whatsappChannelIdentifier,
          config: bot.whatsappConfig,
        },
        conv.whatsappPhoneNumber,
        msg,
      );
    }
  }
}
