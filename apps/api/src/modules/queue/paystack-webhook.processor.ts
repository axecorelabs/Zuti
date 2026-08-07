import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { createHmac, timingSafeEqual } from 'crypto';
import { BillingService } from '../billing/billing.service';
import { CommerceService } from '../commerce/commerce.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { PAYSTACK_WEBHOOK_QUEUE } from './queue.module';

export const PAYSTACK_WEBHOOK_JOB = { PROCESS: 'process' } as const;

export const PAYSTACK_WEBHOOK_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 200,
  removeOnFail: false, // keep failed jobs — same DLQ convention as receipts
};

export interface PaystackWebhookJobPayload {
  signature: string | null;
  rawBody: string; // base64-encoded — Buffers aren't directly job-serializable
  payload: any;
}

/**
 * Runs the actual Paystack webhook side effects (billing credit, commerce order confirmation,
 * ticket-registration confirmation) off the request path. The controller's only job is to ack
 * Paystack fast; this processor does the DB writes and the outbound re-verify call to Paystack's
 * own API, each of which billing/commerce/registrations already do independently and idempotently.
 * A thrown error here fails the BullMQ job, which retries with backoff (see job options above) —
 * a more controllable mechanism than depending on Paystack's own webhook-redelivery behavior.
 */
@Processor(PAYSTACK_WEBHOOK_QUEUE)
export class PaystackWebhookProcessor {
  private readonly logger = new Logger(PaystackWebhookProcessor.name);

  constructor(
    private readonly billing: BillingService,
    private readonly commerce: CommerceService,
    private readonly registrations: RegistrationsService,
    private readonly config: ConfigService,
  ) {}

  @Process(PAYSTACK_WEBHOOK_JOB.PROCESS)
  async handle(job: Job<PaystackWebhookJobPayload>) {
    const { signature, rawBody: rawBodyBase64, payload } = job.data;
    const rawBody = Buffer.from(rawBodyBase64, 'base64');

    // Billing and commerce each independently verify the signature (via their own private copy of
    // the same HMAC check) before acting on their own reference-prefix-matched slice of the event —
    // unchanged from when this ran inline in the controller.
    await this.billing.handlePaystackWebhook(signature ?? undefined, rawBody, payload);
    await this.commerce.handlePaystackWebhook(signature ?? undefined, rawBody, payload);

    // Registration payments — covers both the single-ticket ('zuti-registration') and cart
    // ('zuti-registration-cart') sources.
    const registrationSources = new Set(['zuti-registration', 'zuti-registration-cart']);
    if (payload?.event === 'charge.success' && registrationSources.has(payload?.data?.metadata?.source)) {
      if (!this.isPaystackSignatureValid(signature, rawBody)) {
        this.logger.warn('Ignoring registration Paystack webhook with invalid signature');
        return;
      }
      const reference = payload?.data?.reference;
      if (typeof reference === 'string' && reference) {
        await this.registrations.handlePaymentConfirmed(reference);
      }
    }
  }

  private isPaystackSignatureValid(signature: string | null | undefined, rawBody: Buffer): boolean {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) return false;
    if (!signature || !rawBody?.length) return false;
    if (!/^[a-fA-F0-9]{128}$/.test(signature)) return false;
    const digest = createHmac('sha512', secret).update(rawBody).digest('hex').toLowerCase();
    const digestBuf = Buffer.from(digest, 'utf8');
    const sigBuf = Buffer.from(signature.toLowerCase(), 'utf8');
    if (digestBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(digestBuf, sigBuf);
  }
}
