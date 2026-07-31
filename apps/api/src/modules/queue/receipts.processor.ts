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
import { EventsGateway } from '../events/events.gateway';
import { sendWhatsAppText } from '../../common/utils/whatsapp';
import { computeGrossUpForSubaccount } from '../../common/utils/payment-split';

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

export interface AnnouncementJobPayload {
  announcementId: string;
  orgId: string;
  to: string;
  subject: string;
  body: string;
  eventName: string;
  orgName: string | null;
}

export interface WaitlistOfferJobPayload {
  waitlistEntryId: string;
  entryId: string;
  orgId: string;
  paymentUrl: string | null; // null for free events (already confirmed, no payment step)
  offerExpiresAt: string | null; // ISO string; null for free events
}

export const RECEIPT_JOB = {
  REGISTRATION: 'registration',
  CREDITS: 'credits',
  ECOMMERCE: 'ecommerce',
  ANNOUNCEMENT: 'announcement',
  WAITLIST_OFFER: 'waitlist_offer',
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
    private readonly events: EventsGateway,
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
    const quantity = entry.quantity ?? 1;
    const unitPrice = entry.product.priceMinor ?? 0;
    const ticketMinor = (entry.amountMinor && entry.amountMinor > 0) ? entry.amountMinor : unitPrice * quantity;

    // The customer may have been charged MORE than the ticket price (Paystack/platform fees grossed
    // on top when the org has a payout account — see payment-split.ts). A purchase can cover several
    // tickets sharing one payment reference, each getting its own receipt, so recover the REAL total
    // charged for the whole purchase and give this ticket its proportional share of the fee, so every
    // receipt is honest about what was actually charged (never understates it).
    let totalMinor = ticketMinor;
    let feeShareMinor = 0;
    if (!entry.product.isFree && entry.paystackReference) {
      const siblings = await prismaAny.registrationEntry.findMany({
        where: { paystackReference: entry.paystackReference, orgId },
        select: { amountMinor: true },
      });
      const groupTicketMinor = siblings.reduce((s: number, e: { amountMinor: number | null }) => s + (e.amountMinor ?? 0), 0) || ticketMinor;
      const orgSubaccount = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { paystackSubaccountCode: true } });
      if (orgSubaccount?.paystackSubaccountCode) {
        const groupFee = computeGrossUpForSubaccount(groupTicketMinor).gross - groupTicketMinor;
        feeShareMinor = groupTicketMinor > 0 ? Math.round(groupFee * (ticketMinor / groupTicketMinor)) : 0;
        totalMinor = ticketMinor + feeShareMinor;
      }
    }

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
      quantity,
      ...brand,
    });

    // 2. Payment receipt email — only when an actual payment was made
    if (!entry.product.isFree) {
      await this.mail.sendPaymentReceipt({
        to: entry.customerEmail,
        recipientName: entry.customerName,
        receiptNumber,
        description: `${entry.product.name} — Event Registration`,
        lineItems: [
          {
            label: quantity > 1 ? `${entry.product.name} (${quantity} tickets × ${entry.product.currency ?? 'NGN'} ${(unitPrice / 100).toFixed(2)})` : entry.product.name,
            amountMinor: ticketMinor,
            currency: entry.product.currency ?? 'NGN',
          },
          ...(feeShareMinor > 0 ? [{ label: 'Payment processing fee', amountMinor: feeShareMinor, currency: entry.product.currency ?? 'NGN' }] : []),
        ],
        totalMinor,
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

  // ── Event announcement — one job per recipient; tallies delivery on the record ─

  @Process(RECEIPT_JOB.ANNOUNCEMENT)
  async handleAnnouncement(job: Job<AnnouncementJobPayload>) {
    const { announcementId, orgId, to, subject, body, eventName, orgName } = job.data;
    const prismaAny = this.prisma as any;
    try {
      await this.mail.sendEventAnnouncement({ to, subject, body, eventName, orgName });
      const updated = await prismaAny.eventAnnouncement.update({ where: { id: announcementId }, data: { sentCount: { increment: 1 } } });
      await this.finalizeAnnouncement(prismaAny, updated);
    } catch (err) {
      // Only tally a failure on the FINAL attempt — otherwise a retry that later succeeds would be
      // double-counted (both failed and sent). Non-final failures just rethrow to trigger the retry.
      const isLastAttempt = job.attemptsMade >= ((job.opts.attempts ?? 1) - 1);
      if (isLastAttempt) {
        try {
          const updated = await prismaAny.eventAnnouncement.update({ where: { id: announcementId }, data: { failedCount: { increment: 1 } } });
          await this.finalizeAnnouncement(prismaAny, updated);
        } catch { /* record may be gone */ }
      }
      this.logger.warn(`Announcement job ${job.id}: send to ${to} failed (attempt ${job.attemptsMade + 1}): ${String(err)}`);
      throw err;
    }
  }

  /** Flip status to SENT/PARTIAL once every recipient job has reported (sent + failed === total), and
   * push ONE websocket update so the Messages history snaps to its final state without polling. The
   * status flip is conditional (updateMany where status='SENDING') so among concurrent last-jobs
   * exactly one wins and emits — no double-fire, one emit per send regardless of recipient count. */
  private async finalizeAnnouncement(prismaAny: any, a: { id: string; orgId: string; productId: string; totalRecipients: number; sentCount: number; failedCount: number; status: string }) {
    if (a.status !== 'SENDING') return;
    if (a.sentCount + a.failedCount < a.totalRecipients) return;
    const finalStatus = a.failedCount > 0 ? 'PARTIAL' : 'SENT';
    const res = await prismaAny.eventAnnouncement.updateMany({ where: { id: a.id, status: 'SENDING' }, data: { status: finalStatus } });
    if (res.count === 0) return; // another concurrent job already finalized it
    try {
      this.events.emitAnnouncementUpdate(a.orgId, { id: a.id, productId: a.productId, status: finalStatus, sentCount: a.sentCount, failedCount: a.failedCount, totalRecipients: a.totalRecipients });
    } catch { /* non-fatal */ }
  }

  // ── Waitlist offer — a spot opened up; notify the next person in line ─────

  @Process(RECEIPT_JOB.WAITLIST_OFFER)
  async handleWaitlistOffer(job: Job<WaitlistOfferJobPayload>) {
    const { waitlistEntryId, entryId, orgId, paymentUrl, offerExpiresAt } = job.data;
    const prismaAny = this.prisma as any;

    const waitlistEntry = await prismaAny.registrationWaitlistEntry.findFirst({
      where: { id: waitlistEntryId, orgId },
      include: { product: { select: { name: true, venue: true, organization: { select: { name: true } } } } },
    });
    if (!waitlistEntry || !waitlistEntry.customerEmail) {
      this.logger.warn(`Waitlist offer job ${job.id}: entry ${waitlistEntryId} not found or has no email — discarding`);
      return;
    }
    const eventName = waitlistEntry.product.name;
    const orgName = waitlistEntry.product.organization?.name ?? null;
    const appUrl = this.getAppUrl();

    const deadline = offerExpiresAt ? new Date(offerExpiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : null;
    const subject = paymentUrl ? `A spot opened up for ${eventName}!` : `You're in! Your spot for ${eventName} is confirmed`;
    const body = paymentUrl
      ? `Good news — a spot just opened up for "${eventName}" and it's yours!\n\nComplete your payment by ${deadline} to claim it:\n${paymentUrl}\n\nIf we don't hear from you by then, the spot will pass to the next person on the waitlist.`
      : `Good news — a spot just opened up for "${eventName}" and you're confirmed!\n\nYour ticket has been emailed separately. See you there!`;

    await this.mail.sendEventAnnouncement({ to: waitlistEntry.customerEmail, subject, body, eventName, orgName });

    // Also notify on the channel they joined from, when available (best-effort).
    if (waitlistEntry.conversationId) {
      try {
        const conv = await prismaAny.conversation.findUnique({ where: { id: waitlistEntry.conversationId }, select: { channel: true, telegramChatId: true, whatsappPhoneNumber: true } });
        const bot = waitlistEntry.botId ? await prismaAny.bot.findUnique({ where: { id: waitlistEntry.botId }, select: { telegramToken: true, whatsappProvider: true, whatsappChannelIdentifier: true, whatsappConfig: true } }) : null;
        if (conv && bot) {
          const msg = paymentUrl
            ? `A spot opened up for "${eventName}"! Complete payment by ${deadline} to claim it:\n${paymentUrl}`
            : `A spot opened up for "${eventName}" — you're confirmed! Your ticket has been emailed to you.`;
          if (conv.channel === 'TELEGRAM' && conv.telegramChatId && bot.telegramToken) {
            await firstValueFrom(this.http.post(`https://api.telegram.org/bot${bot.telegramToken}/sendMessage`, { chat_id: conv.telegramChatId, text: msg }));
          } else if (conv.channel === 'WHATSAPP' && conv.whatsappPhoneNumber) {
            await sendWhatsAppText(this.http, { provider: bot.whatsappProvider, channelIdentifier: bot.whatsappChannelIdentifier, config: bot.whatsappConfig }, conv.whatsappPhoneNumber, msg);
          }
        }
      } catch (err) {
        this.logger.warn(`Waitlist offer job ${job.id}: channel notify failed (non-fatal): ${String(err)}`);
      }
    }

    this.logger.log(`Waitlist offer job ${job.id}: notified ${waitlistEntry.customerEmail} for entry ${entryId}`);
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
    // payment.amountMinor is the amount ACTUALLY charged (grossed up for Paystack/platform fees when
    // the store has a payout account — see commerce.service.ts initializeOrderPayment); order.totalMinor
    // is the true order value. Show the difference as its own line so the receipt never understates
    // what the customer's card was charged.
    const totalCharged = (payment?.amountMinor && payment.amountMinor > 0) ? payment.amountMinor : order.totalMinor;
    const feeMinor = Math.max(0, totalCharged - order.totalMinor);
    if (feeMinor > 0) lineItems.push({ label: 'Payment processing fee', amountMinor: feeMinor, currency: order.currency });

    await this.mail.sendPaymentReceipt({
      to: order.customerEmail,
      recipientName: order.customerName,
      receiptNumber,
      description: `${order.store.name} — Order Receipt`,
      lineItems,
      totalMinor: totalCharged,
      currency: order.currency,
      reference,
      paidAt: payment?.paidAt ?? new Date(),
      companyName: org?.name ?? brand.appName,
      companyId: orgId,
      ...brand,
    });

    this.logger.log(`Receipt job ${job.id}: ecommerce receipt sent to ${order.customerEmail}`);

    // Confirm to the customer on the channel they ordered from (Telegram/WhatsApp) — same as the
    // registration flow. Non-fatal: a channel hiccup must not fail (and retry) the whole receipt job.
    try {
      await this.sendEcommerceChannelConfirmation(order, reference, receiptNumber);
    } catch (err) {
      this.logger.warn(`Receipt job ${job.id}: ecommerce channel message failed (non-fatal): ${String(err)}`);
    }
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

    const quantity = entry.quantity ?? 1;
    const ticketLabel = quantity > 1 ? `${quantity} tickets` : 'ticket';
    const msg =
      `Your registration is confirmed! 🎉\n\n` +
      `Your ${ticketLabel} and payment receipt have been sent to ${entry.customerEmail}.\n\n` +
      `Ref: ${reference.slice(-8).toUpperCase()}\n` +
      `View ticket: ${appUrl}/ticket/${entry.id}`;

    // Persist the confirmation as an assistant message and push it to the inbox live, so the
    // dashboard shows the post-payment confirmation just like any other bot reply.
    try {
      const aiMessage = await prismaAny.message.create({
        data: { conversationId: entry.conversationId, role: 'ASSISTANT', content: msg },
      });
      await prismaAny.conversation.update({
        where: { id: entry.conversationId },
        data: { lastMessageAt: new Date() },
      });
      this.events.emitNewMessage(entry.orgId, { conversationId: entry.conversationId, message: aiMessage });
    } catch (err) {
      this.logger.warn(`Failed to persist registration confirmation message: ${String(err)}`);
    }

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

  private async sendEcommerceChannelConfirmation(order: any, reference: string, receiptNumber: string) {
    // Bot orders stash the originating conversation + bot on the order metadata (set in the bridge).
    const meta = (order.metadata && typeof order.metadata === 'object' ? order.metadata : {}) as Record<string, unknown>;
    const conversationId = typeof meta.conversationId === 'string' ? meta.conversationId : null;
    const botId = typeof meta.botId === 'string' ? meta.botId : null;
    if (!conversationId || !botId) return; // dashboard/manual orders have no chat to reply to

    const prismaAny = this.prisma as any;
    const conv = await prismaAny.conversation.findUnique({
      where: { id: conversationId },
      select: { channel: true, telegramChatId: true, whatsappPhoneNumber: true },
    });
    if (!conv) return;

    const bot = await prismaAny.bot.findUnique({
      where: { id: botId },
      select: {
        telegramToken: true,
        whatsappProvider: true,
        whatsappChannelIdentifier: true,
        whatsappConfig: true,
      },
    });
    if (!bot) return;

    const total = (order.totalMinor / 100).toLocaleString('en-NG', {
      style: 'currency',
      currency: order.currency,
      minimumFractionDigits: 0,
    });
    const msg =
      `Payment received — thank you! ✅\n\n` +
      `Your order from ${order.store?.name ?? 'the store'} is confirmed.\n` +
      `Total paid: ${total}\n\n` +
      `A receipt (${receiptNumber}) has been sent to ${order.customerEmail}.\n` +
      `Ref: ${reference.slice(-8).toUpperCase()}`;

    // Persist as an assistant message + push to the inbox live, so the dashboard shows the
    // post-payment confirmation just like any other bot reply.
    try {
      const aiMessage = await prismaAny.message.create({
        data: { conversationId, role: 'ASSISTANT', content: msg },
      });
      await prismaAny.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });
      this.events.emitNewMessage(order.organizationId, { conversationId, message: aiMessage });
    } catch (err) {
      this.logger.warn(`Failed to persist ecommerce confirmation message: ${String(err)}`);
    }

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
