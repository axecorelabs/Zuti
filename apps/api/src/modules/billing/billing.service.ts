import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  BillingTransactionKind,
  BillingTransactionStatus,
  CreditLedgerType,
  Prisma,
} from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PricingMarket, PricingService } from '../pricing/pricing.service';
import { ActivityAction, ActivityService } from '../activity/activity.service';
import {
  BASE_CREDIT_UNITS_DEFAULT,
  BASE_CREDIT_UNITS_PER_CUSTOMER_REPLY,
  CREDIT_UNITS_PER_CREDIT,
  computeUsageOverageCredits,
  computeUsageOverageUnits,
} from './credit-model';

type CheckoutRequest = {
  market: PricingMarket;
  callbackUrl?: string;
  idempotencyKey?: string;
};

type UsageDebitInput = {
  organizationId: string;
  usageType: string;
  promptTokens: number;
  completionTokens: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    paid_at?: string;
    authorization?: {
      authorization_code?: string;
      card_type?: string;
      bank?: string;
      reusable?: boolean;
    };
    customer?: {
      email?: string;
      customer_code?: string;
    };
  };
};

type PaystackChargeAuthorizationResponse = {
  status: boolean;
  message: string;
  data: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    paid_at?: string;
  };
};

function fromCreditUnits(units: number) {
  return Number((units / CREDIT_UNITS_PER_CREDIT).toFixed(2));
}

function toCreditUnits(credits: number) {
  return Math.max(0, Math.floor(credits)) * CREDIT_UNITS_PER_CREDIT;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly paystackReferencePattern = /^zuti_[0-9]{13}_[a-f0-9]{12}$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly activity: ActivityService,
  ) {}

  async getWallet(organizationId: string) {
    const billing = await this.ensureBilling(organizationId);
    const recentLedger = await this.prisma.creditLedger.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        creditsDeltaUnits: true,
        balanceAfterUnits: true,
        description: true,
        createdAt: true,
        transactionId: true,
      },
    });

    return {
      organizationId,
      plan: billing.plan,
      creditBalance: fromCreditUnits(billing.creditBalanceUnits),
      committedMonthlyCredits: fromCreditUnits(billing.committedMonthlyCreditsUnits),
      commitmentRenewsAt: billing.commitmentRenewsAt,
      recentLedger: recentLedger.map((entry) => ({
        ...entry,
        creditsDelta: fromCreditUnits(entry.creditsDeltaUnits),
        balanceAfter: fromCreditUnits(entry.balanceAfterUnits),
      })),
    };
  }

  async assertMinimumCredits(organizationId: string, minCredits = 1) {
    const billing = await this.ensureBilling(organizationId);
    const minUnits = toCreditUnits(minCredits);
    if (billing.creditBalanceUnits < minUnits) {
      await this.logBillingActivity(
        organizationId,
        ActivityAction.BILLING_SECURITY_ALERT,
        {
          reason: 'insufficient_credits_precheck',
          requiredCredits: minCredits,
          requiredCreditUnits: minUnits,
            availableCredits: fromCreditUnits(billing.creditBalanceUnits),
          availableCreditUnits: billing.creditBalanceUnits,
        },
        null,
      );
      throw new HttpException(
        {
          code: 'INSUFFICIENT_CREDITS',
          message: 'Insufficient credits. Please top up your wallet to continue.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return { ok: true, creditBalance: fromCreditUnits(billing.creditBalanceUnits) };
  }

  async debitUsageCredits(input: UsageDebitInput) {
    return this.prisma.$transaction(async (tx) => {
      const billing = await tx.billing.findUnique({ where: { organizationId: input.organizationId } });
      if (!billing) throw new NotFoundException('Billing record not found');

      const isCustomerReply = input.usageType === 'CUSTOMER_REPLY';
      const baseCreditUnits = isCustomerReply
        ? BASE_CREDIT_UNITS_PER_CUSTOMER_REPLY
        : BASE_CREDIT_UNITS_DEFAULT;
      const overageCredits = computeUsageOverageCredits(input.promptTokens, input.completionTokens, 1);
      const overageCreditUnits = computeUsageOverageUnits(input.promptTokens, input.completionTokens, 1);
      const creditsToDebitUnits = baseCreditUnits + overageCreditUnits;
      const creditsToDebit = fromCreditUnits(creditsToDebitUnits);

      const ledgerKey = input.idempotencyKey ? `usage:${input.idempotencyKey}` : null;
      if (ledgerKey) {
        const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: ledgerKey } });
        if (existing) {
          return {
            creditsDebited: Math.abs(fromCreditUnits(existing.creditsDeltaUnits)),
            balanceAfter: fromCreditUnits(existing.balanceAfterUnits),
            deduplicated: true,
          };
        }
      }

      if (billing.creditBalanceUnits < creditsToDebitUnits) {
        await this.logBillingActivity(
          input.organizationId,
          ActivityAction.BILLING_SECURITY_ALERT,
          {
            reason: 'insufficient_credits_debit',
            usageType: input.usageType,
            requiredCredits: creditsToDebit,
            requiredCreditUnits: creditsToDebitUnits,
            availableCredits: fromCreditUnits(billing.creditBalanceUnits),
            availableCreditUnits: billing.creditBalanceUnits,
          },
          null,
        );
        throw new HttpException(
          {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits. Please top up your wallet to continue.',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      const nextBalanceUnits = billing.creditBalanceUnits - creditsToDebitUnits;
      const nextBalance = fromCreditUnits(nextBalanceUnits);

      try {
        await tx.creditLedger.create({
          data: {
            organizationId: input.organizationId,
            billingId: billing.id,
            type: CreditLedgerType.USAGE,
            creditsDeltaUnits: -creditsToDebitUnits,
            balanceAfterUnits: nextBalanceUnits,
            description: `AI usage debit (${input.usageType})`,
            idempotencyKey: ledgerKey,
            metadata: {
              usageType: input.usageType,
              promptTokens: Math.max(0, Math.floor(input.promptTokens)),
              completionTokens: Math.max(0, Math.floor(input.completionTokens)),
              baseCredits: baseCreditUnits / CREDIT_UNITS_PER_CREDIT,
              baseCreditUnits,
              overageCredits,
              overageCreditUnits,
              creditsDebited: creditsToDebit,
              creditsDebitedUnits: creditsToDebitUnits,
              ...(input.metadata ?? {}),
            } as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          if (ledgerKey) {
            const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: ledgerKey } });
            if (existing) {
              return {
                creditsDebited: Math.abs(fromCreditUnits(existing.creditsDeltaUnits)),
                balanceAfter: fromCreditUnits(existing.balanceAfterUnits),
                deduplicated: true,
              };
            }
          }
        }
        throw error;
      }

      await tx.billing.update({
        where: { id: billing.id },
        data: {
          creditBalanceUnits: nextBalanceUnits,
          messageCount: { increment: 1 },
        },
      });

      await this.logBillingActivity(
        input.organizationId,
        ActivityAction.BILLING_STATUS_UPDATED,
        {
          reason: 'usage_debit_applied',
          usageType: input.usageType,
          promptTokens: Math.max(0, Math.floor(input.promptTokens)),
          completionTokens: Math.max(0, Math.floor(input.completionTokens)),
          baseCredits: baseCreditUnits / CREDIT_UNITS_PER_CREDIT,
          baseCreditUnits,
          overageCredits,
          overageCreditUnits,
          creditsDebited: creditsToDebit,
          creditsDebitedUnits: creditsToDebitUnits,
          balanceAfter: nextBalance,
          balanceAfterUnits: nextBalanceUnits,
        },
        null,
      );

      return { creditsDebited: creditsToDebit, balanceAfter: nextBalance, deduplicated: false };
    });
  }

  async initializePackCheckout(
    userId: string,
    organizationId: string,
    dto: CheckoutRequest & { packId: string },
  ) {
    const billing = await this.ensureBilling(organizationId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) throw new BadRequestException('User email is required for checkout');

    const catalog = this.pricing.getCatalog(dto.market);
    const pack = catalog.creditPacks.find((item) => item.id === dto.packId);
    if (!pack) {
      throw new BadRequestException('Unknown credit pack for selected market');
    }
    if (pack.amountMinor <= 0 || pack.credits <= 0) {
      throw new BadRequestException('Invalid credit pack configuration');
    }

    const scopedIdempotencyKey = this.toScopedIdempotencyKey(
      organizationId,
      userId,
      BillingTransactionKind.CREDIT_PACK,
      dto.idempotencyKey,
    );
    if (scopedIdempotencyKey) {
      const existing = await this.prisma.billingTransaction.findUnique({
        where: { idempotencyKey: scopedIdempotencyKey },
      });
      if (existing) {
        await this.logBillingActivity(
          organizationId,
          ActivityAction.BILLING_IDEMPOTENCY_REUSED,
          {
            provider: 'paystack',
            kind: BillingTransactionKind.CREDIT_PACK,
            reference: existing.reference,
            idempotencyKeyPresent: true,
            status: existing.status,
          },
          userId,
          existing.reference,
        );
        return this.formatExistingCheckout(existing);
      }
    }

    const reference = this.createReference();
    const callbackUrl = this.resolveCallbackUrl(dto.callbackUrl, organizationId, reference);

    const initialized = await this.initializePaystackTransaction({
      reference,
      email: user.email,
      amountMinor: pack.amountMinor,
      currency: pack.currency,
      callbackUrl,
      metadata: {
        organizationId,
        market: dto.market,
        productType: 'credit_pack',
        packId: pack.id,
        credits: pack.credits,
      },
    });

    await this.prisma.billingTransaction.create({
      data: {
        organizationId,
        billingId: billing.id,
        initiatedById: userId,
        idempotencyKey: scopedIdempotencyKey,
        kind: BillingTransactionKind.CREDIT_PACK,
        status: BillingTransactionStatus.PENDING,
        reference,
        amountMinor: pack.amountMinor,
        currency: pack.currency,
        creditsUnits: toCreditUnits(pack.credits),
        metadata: {
          market: dto.market,
          packId: pack.id,
          callbackUrl,
          authorizationUrl: initialized.data.authorization_url,
        },
      },
    });

    await this.logBillingActivity(
      organizationId,
      ActivityAction.BILLING_CHECKOUT_INITIALIZED,
      {
        provider: 'paystack',
        kind: BillingTransactionKind.CREDIT_PACK,
        amountMinor: pack.amountMinor,
        currency: pack.currency,
        credits: pack.credits,
      },
      userId,
      reference,
    );

    return {
      provider: 'paystack',
      reference,
      authorizationUrl: initialized.data.authorization_url,
      amountMinor: pack.amountMinor,
      currency: pack.currency,
      credits: pack.credits,
      note: 'Card details are collected by Paystack only; no card PAN/CVV is stored in Zuti.',
    };
  }

  async initializeCommitmentCheckout(
    userId: string,
    organizationId: string,
    dto: CheckoutRequest & { subscriptionId: string },
  ) {
    const billing = await this.ensureBilling(organizationId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) throw new BadRequestException('User email is required for checkout');

    const catalog = this.pricing.getCatalog(dto.market);
    const plan = catalog.subscriptions.find((item) => item.id === dto.subscriptionId);
    if (!plan) {
      throw new BadRequestException('Unknown commitment plan for selected market');
    }
    if (plan.amountMinor <= 0 || plan.includedCredits <= 0) {
      throw new BadRequestException('Invalid commitment plan configuration');
    }

    const scopedIdempotencyKey = this.toScopedIdempotencyKey(
      organizationId,
      userId,
      BillingTransactionKind.COMMITMENT,
      dto.idempotencyKey,
    );
    if (scopedIdempotencyKey) {
      const existing = await this.prisma.billingTransaction.findUnique({
        where: { idempotencyKey: scopedIdempotencyKey },
      });
      if (existing) {
        await this.logBillingActivity(
          organizationId,
          ActivityAction.BILLING_IDEMPOTENCY_REUSED,
          {
            provider: 'paystack',
            kind: BillingTransactionKind.COMMITMENT,
            reference: existing.reference,
            idempotencyKeyPresent: true,
            status: existing.status,
          },
          userId,
          existing.reference,
        );
        return this.formatExistingCheckout(existing);
      }
    }

    const reference = this.createReference();
    const callbackUrl = this.resolveCallbackUrl(dto.callbackUrl, organizationId, reference);

    const initialized = await this.initializePaystackTransaction({
      reference,
      email: user.email,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      callbackUrl,
      metadata: {
        organizationId,
        market: dto.market,
        productType: 'commitment',
        subscriptionId: plan.id,
        credits: plan.includedCredits,
      },
    });

    await this.prisma.billingTransaction.create({
      data: {
        organizationId,
        billingId: billing.id,
        initiatedById: userId,
        idempotencyKey: scopedIdempotencyKey,
        kind: BillingTransactionKind.COMMITMENT,
        status: BillingTransactionStatus.PENDING,
        reference,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        creditsUnits: toCreditUnits(plan.includedCredits),
        metadata: {
          market: dto.market,
          subscriptionId: plan.id,
          callbackUrl,
          authorizationUrl: initialized.data.authorization_url,
        },
      },
    });

    await this.logBillingActivity(
      organizationId,
      ActivityAction.BILLING_CHECKOUT_INITIALIZED,
      {
        provider: 'paystack',
        kind: BillingTransactionKind.COMMITMENT,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        credits: plan.includedCredits,
      },
      userId,
      reference,
    );

    return {
      provider: 'paystack',
      reference,
      authorizationUrl: initialized.data.authorization_url,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      credits: plan.includedCredits,
      note: 'Card details are collected by Paystack only; no card PAN/CVV is stored in Zuti.',
    };
  }

  async verifyAndApply(organizationId: string, reference: string) {
    if (!this.paystackReferencePattern.test(reference)) {
      throw new BadRequestException('Invalid payment reference format');
    }

    const pending = await this.prisma.billingTransaction.findUnique({
      where: { reference },
      select: {
        id: true,
        organizationId: true,
        amountMinor: true,
        currency: true,
        status: true,
      },
    });

    if (!pending || pending.organizationId !== organizationId) {
      throw new NotFoundException('Payment reference not found for this organization');
    }

    if (pending.status === BillingTransactionStatus.SUCCESS) {
      return { ok: true, status: 'success', applied: { credited: false, alreadyApplied: true } };
    }

    if (pending.status !== BillingTransactionStatus.PENDING) {
      return { ok: false, status: pending.status.toLowerCase(), applied: false };
    }

    const verification = await this.verifyPaystackTransaction(reference);
    if (!verification.status || verification.data.status !== 'success') {
      await this.markTransactionStatus(reference, this.mapPaystackStatus(verification.data.status));
      await this.logBillingActivity(
        organizationId,
        ActivityAction.BILLING_VERIFICATION_FAILED,
        {
          provider: 'paystack',
          reference,
          providerStatus: verification.data.status,
        },
        null,
        reference,
      );
      return { ok: false, status: verification.data.status, applied: false };
    }

    if (
      verification.data.amount !== pending.amountMinor ||
      verification.data.currency?.toUpperCase() !== pending.currency?.toUpperCase()
    ) {
      await this.logBillingActivity(
        organizationId,
        ActivityAction.BILLING_SECURITY_ALERT,
        {
          provider: 'paystack',
          reference,
          expectedAmountMinor: pending.amountMinor,
          receivedAmountMinor: verification.data.amount,
          expectedCurrency: pending.currency,
          receivedCurrency: verification.data.currency,
        },
        null,
        reference,
      );
      throw new BadRequestException('Verified payment amount/currency mismatch');
    }

    const applied = await this.applySuccessfulTransaction(reference, verification.data.paid_at, verification.data);
    await this.logBillingActivity(
      organizationId,
      ActivityAction.BILLING_CREDIT_APPLIED,
      {
        provider: 'paystack',
        reference,
        credited: applied.credited,
        alreadyApplied: applied.alreadyApplied,
      },
      null,
      reference,
    );
    return { ok: true, status: verification.data.status, applied };
  }

  async handlePaystackWebhook(signature: string | undefined, rawBody: Buffer, payload: any) {
    if (!this.isPaystackSignatureValid(signature, rawBody)) {
      this.logger.warn('Ignoring Paystack webhook with invalid signature');
      return { ok: true };
    }

    if (payload?.event !== 'charge.success') {
      return { ok: true };
    }

    const reference = payload?.data?.reference;
    if (!reference || typeof reference !== 'string') {
      return { ok: true };
    }
    if (!this.paystackReferencePattern.test(reference)) {
      this.logger.warn(`Ignoring malformed Paystack reference: ${reference}`);
      return { ok: true };
    }

    const pending = await this.prisma.billingTransaction.findUnique({
      where: { reference },
      select: { organizationId: true, amountMinor: true, currency: true },
    });

    if (!pending) {
      this.logger.warn(`Paystack reference not recognized: ${reference}`);
      return { ok: true };
    }

    const providerStatus = this.mapPaystackStatus(String(payload?.data?.status ?? ''));
    if (providerStatus !== BillingTransactionStatus.SUCCESS) {
      await this.markTransactionStatus(reference, providerStatus);
      await this.logBillingActivity(
        pending.organizationId,
        ActivityAction.BILLING_STATUS_UPDATED,
        {
          provider: 'paystack',
          reference,
          status: providerStatus,
          source: 'webhook_event_status',
        },
        null,
        reference,
      );
      return { ok: true };
    }

    const verification = await this.verifyPaystackTransaction(reference);
    if (!verification.status || verification.data.status !== 'success') {
      this.logger.warn(`Paystack verification not successful for ${reference}`);
      await this.markTransactionStatus(reference, this.mapPaystackStatus(verification.data.status));
      await this.logBillingActivity(
        pending.organizationId,
        ActivityAction.BILLING_VERIFICATION_FAILED,
        {
          provider: 'paystack',
          reference,
          providerStatus: verification.data.status,
          source: 'webhook_verify',
        },
        null,
        reference,
      );
      return { ok: true };
    }

    if (
      verification.data.amount !== pending.amountMinor ||
      verification.data.currency?.toUpperCase() !== pending.currency?.toUpperCase()
    ) {
      this.logger.error(`Paystack mismatch for ${reference}: amount/currency differs`);
      await this.markTransactionStatus(reference, BillingTransactionStatus.FAILED);
      await this.logBillingActivity(
        pending.organizationId,
        ActivityAction.BILLING_SECURITY_ALERT,
        {
          provider: 'paystack',
          reference,
          expectedAmountMinor: pending.amountMinor,
          receivedAmountMinor: verification.data.amount,
          expectedCurrency: pending.currency,
          receivedCurrency: verification.data.currency,
          source: 'webhook_verify',
        },
        null,
        reference,
      );
      return { ok: true };
    }

    const applied = await this.applySuccessfulTransaction(reference, verification.data.paid_at, verification.data);
    await this.logBillingActivity(
      pending.organizationId,
      ActivityAction.BILLING_CREDIT_APPLIED,
      {
        provider: 'paystack',
        reference,
        credited: applied.credited,
        alreadyApplied: applied.alreadyApplied,
        source: 'webhook',
      },
      null,
      reference,
    );
    return { ok: true };
  }

  async runDueCommitmentRenewals() {
    const dueBillings = await this.prisma.billing.findMany({
      where: {
        committedMonthlyCreditsUnits: { gt: 0 },
        commitmentRenewsAt: { lte: new Date() },
      },
      select: {
        id: true,
        organizationId: true,
        committedMonthlyCreditsUnits: true,
        commitmentRenewsAt: true,
      },
      take: 100,
    });

    for (const billing of dueBillings) {
      const dueDate = billing.commitmentRenewsAt ?? new Date();
      const cycleKey = `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const idempotencyKey = `renew:${billing.id}:${cycleKey}`;

      const latestCommitment = await this.prisma.billingTransaction.findFirst({
        where: {
          billingId: billing.id,
          kind: BillingTransactionKind.COMMITMENT,
          status: BillingTransactionStatus.SUCCESS,
        },
        orderBy: { paidAt: 'desc' },
        select: {
          amountMinor: true,
          currency: true,
          metadata: true,
        },
      });

      if (!latestCommitment) {
        continue;
      }

      const meta = (latestCommitment.metadata ?? {}) as Record<string, unknown>;
      const authorizationCode = typeof meta.authorizationCode === 'string' ? meta.authorizationCode : null;
      const customerEmail = typeof meta.customerEmail === 'string' ? meta.customerEmail : null;

      if (!authorizationCode || !customerEmail) {
        await this.logBillingActivity(
          billing.organizationId,
          ActivityAction.BILLING_SECURITY_ALERT,
          {
            reason: 'missing_commitment_renewal_profile',
            billingId: billing.id,
            cycleKey,
          },
          null,
        );
        continue;
      }

      const existing = await this.prisma.billingTransaction.findUnique({
        where: { idempotencyKey },
        select: { reference: true, status: true },
      });

      if (existing) {
        if (existing.status === BillingTransactionStatus.PENDING) {
          const verification = await this.verifyPaystackTransaction(existing.reference);
          if (verification.status && verification.data.status === 'success') {
            await this.applySuccessfulTransaction(existing.reference, verification.data.paid_at, verification.data);
          }
        }
        continue;
      }

      const reference = this.createReference();

      await this.prisma.billingTransaction.create({
        data: {
          organizationId: billing.organizationId,
          billingId: billing.id,
          idempotencyKey,
          kind: BillingTransactionKind.COMMITMENT,
          status: BillingTransactionStatus.PENDING,
          reference,
          amountMinor: latestCommitment.amountMinor,
          currency: latestCommitment.currency,
          creditsUnits: billing.committedMonthlyCreditsUnits,
          metadata: {
            renewal: true,
            cycleKey,
            authorizationCode,
            customerEmail,
          },
        },
      });

      const charge = await this.chargePaystackAuthorization({
        authorizationCode,
        email: customerEmail,
        amountMinor: latestCommitment.amountMinor,
        currency: latestCommitment.currency,
        reference,
      });

      if (!charge.status || charge.data.status !== 'success') {
        await this.markTransactionStatus(reference, this.mapPaystackStatus(charge.data.status));
        await this.logBillingActivity(
          billing.organizationId,
          ActivityAction.BILLING_VERIFICATION_FAILED,
          {
            reason: 'commitment_renewal_charge_failed',
            reference,
            providerStatus: charge.data.status,
          },
          null,
          reference,
        );
        continue;
      }

      if (
        charge.data.amount !== latestCommitment.amountMinor ||
        charge.data.currency?.toUpperCase() !== latestCommitment.currency?.toUpperCase()
      ) {
        await this.markTransactionStatus(reference, BillingTransactionStatus.FAILED);
        await this.logBillingActivity(
          billing.organizationId,
          ActivityAction.BILLING_SECURITY_ALERT,
          {
            reason: 'commitment_renewal_amount_currency_mismatch',
            reference,
            expectedAmountMinor: latestCommitment.amountMinor,
            receivedAmountMinor: charge.data.amount,
            expectedCurrency: latestCommitment.currency,
            receivedCurrency: charge.data.currency,
          },
          null,
          reference,
        );
        continue;
      }

      await this.applySuccessfulTransaction(reference, charge.data.paid_at);
      await this.logBillingActivity(
        billing.organizationId,
        ActivityAction.BILLING_CREDIT_APPLIED,
        {
          reason: 'commitment_renewal_applied',
          reference,
          cycleKey,
          credits: fromCreditUnits(billing.committedMonthlyCreditsUnits),
          creditsUnits: billing.committedMonthlyCreditsUnits,
        },
        null,
        reference,
      );
    }
  }

  private async applySuccessfulTransaction(
    reference: string,
    paidAtIso?: string,
    verificationData?: PaystackVerifyResponse['data'],
  ) {
    const paidAt = paidAtIso ? new Date(paidAtIso) : new Date();

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.billingTransaction.findUnique({
        where: { reference },
      });

      if (!transaction) return { credited: false, alreadyApplied: false };
      if (transaction.status === BillingTransactionStatus.SUCCESS) {
        return { credited: false, alreadyApplied: true };
      }
      if (transaction.status !== BillingTransactionStatus.PENDING) {
        return { credited: false, alreadyApplied: false };
      }
      const creditUnits = transaction.creditsUnits;
      if (creditUnits <= 0) {
        throw new BadRequestException('Transaction has invalid credit amount');
      }

      const billing = await tx.billing.findUnique({ where: { id: transaction.billingId } });
      if (!billing) throw new NotFoundException('Billing record not found for transaction');

      const nextBalanceUnits = billing.creditBalanceUnits + creditUnits;
      const ledgerKey = `paystack:${transaction.reference}:credit`;

      try {
        await tx.creditLedger.create({
          data: {
            organizationId: transaction.organizationId,
            billingId: transaction.billingId,
            transactionId: transaction.id,
            type:
              transaction.kind === BillingTransactionKind.COMMITMENT
                ? CreditLedgerType.COMMITMENT_ALLOCATION
                : CreditLedgerType.PURCHASE,
            creditsDeltaUnits: creditUnits,
            balanceAfterUnits: nextBalanceUnits,
            description:
              transaction.kind === BillingTransactionKind.COMMITMENT
                ? 'Monthly prepaid commitment allocation via Paystack'
                : 'Credit pack purchase via Paystack',
            idempotencyKey: ledgerKey,
            metadata: (transaction.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          await tx.billingTransaction.update({
            where: { id: transaction.id },
            data: { status: BillingTransactionStatus.SUCCESS, paidAt },
          });
          return { credited: false, alreadyApplied: true };
        }
        throw error;
      }

      const commitmentRenewal = new Date(billing.commitmentRenewsAt ?? paidAt);
      commitmentRenewal.setMonth(commitmentRenewal.getMonth() + 1);

      const metadataObject = (transaction.metadata ?? {}) as Record<string, unknown>;
      const enrichedMetadata: Record<string, unknown> = {
        ...metadataObject,
        ...(verificationData?.authorization?.authorization_code
          ? { authorizationCode: verificationData.authorization.authorization_code }
          : {}),
        ...(verificationData?.customer?.email
          ? { customerEmail: verificationData.customer.email }
          : {}),
        ...(verificationData?.customer?.customer_code
          ? { customerCode: verificationData.customer.customer_code }
          : {}),
      };

      await tx.billing.update({
        where: { id: billing.id },
        data: {
          creditBalanceUnits: { increment: creditUnits },
          ...(transaction.kind === BillingTransactionKind.COMMITMENT && {
            committedMonthlyCreditsUnits: creditUnits,
            commitmentRenewsAt: commitmentRenewal,
          }),
        },
      });

      await tx.billingTransaction.update({
        where: { id: transaction.id },
        data: {
          status: BillingTransactionStatus.SUCCESS,
          paidAt,
          metadata: enrichedMetadata as Prisma.InputJsonValue,
        },
      });

      return { credited: true, alreadyApplied: false };
    });
  }

  private async logBillingActivity(
    orgId: string,
    action: ActivityAction,
    metadata: Record<string, unknown>,
    actorId: string | null,
    reference?: string,
  ) {
    try {
      await this.activity.log(
        orgId,
        actorId,
        actorId ? 'Billing User' : 'Billing System',
        action,
        'billing_transaction',
        reference,
        metadata,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to persist billing activity log for org ${orgId}: ${(error as Error).message}`,
      );
    }
  }

  private isPaystackSignatureValid(signature: string | undefined, rawBody: Buffer) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      this.logger.warn('PAYSTACK_SECRET_KEY is missing; rejecting webhook signature validation');
      return false;
    }
    if (!signature || !rawBody?.length) return false;
    if (!/^[a-fA-F0-9]{128}$/.test(signature)) return false;

    const digest = createHmac('sha512', secret).update(rawBody).digest('hex').toLowerCase();
    const digestBuf = Buffer.from(digest, 'utf8');
    const signatureBuf = Buffer.from(signature.toLowerCase(), 'utf8');

    if (digestBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(digestBuf, signatureBuf);
  }

  private async ensureBilling(organizationId: string) {
    const orgExists = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!orgExists) throw new NotFoundException('Organization not found');

    return this.prisma.billing.upsert({
      where: { organizationId },
      update: {},
      create: {
        organizationId,
        plan: 'STARTER',
        messageCount: 0,
        messageLimit: 0,
        creditBalanceUnits: 0,
        committedMonthlyCreditsUnits: 0,
      },
    });
  }

  private createReference() {
    return `zuti_${Date.now()}_${randomBytes(6).toString('hex')}`;
  }

  private toScopedIdempotencyKey(
    organizationId: string,
    userId: string,
    kind: BillingTransactionKind,
    clientKey?: string,
  ) {
    if (!clientKey) return null;
    const digest = createHash('sha256')
      .update(`${organizationId}|${userId}|${kind}|${clientKey}`)
      .digest('hex');
    return `idem_${digest}`;
  }

  private resolveCallbackUrl(
    requestedCallbackUrl: string | undefined,
    organizationId: string,
    reference: string,
  ) {
    const allowedCallbackPaths = new Set(['/billing-usage']);
    const fallback = this.defaultCallbackUrl(organizationId, reference);
    if (!requestedCallbackUrl) return fallback;

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    let requested: URL;
    let allowed: URL;
    try {
      requested = new URL(requestedCallbackUrl);
      allowed = new URL(appUrl);
    } catch {
      throw new BadRequestException('Invalid callback URL');
    }

    if (requested.origin !== allowed.origin) {
      throw new BadRequestException('Callback URL origin is not allowed');
    }

    const normalizedPath = requested.pathname.replace(/\/+$/, '') || '/';
    if (!allowedCallbackPaths.has(normalizedPath)) {
      throw new BadRequestException('Callback URL path is not allowed');
    }

    return requested.toString();
  }

  private async markTransactionStatus(reference: string, status: BillingTransactionStatus) {
    await this.prisma.billingTransaction.updateMany({
      where: {
        reference,
        status: { not: BillingTransactionStatus.SUCCESS },
      },
      data: { status },
    });
  }

  private mapPaystackStatus(paystackStatus: string): BillingTransactionStatus {
    const normalized = paystackStatus.toLowerCase();
    if (normalized === 'success') return BillingTransactionStatus.SUCCESS;
    if (normalized === 'failed') return BillingTransactionStatus.FAILED;
    if (normalized === 'abandoned') return BillingTransactionStatus.ABANDONED;
    return BillingTransactionStatus.PENDING;
  }

  private formatExistingCheckout(
    existing: {
      organizationId: string;
      kind: BillingTransactionKind;
      reference: string;
      amountMinor: number;
      currency: string;
      creditsUnits: number;
      status: BillingTransactionStatus;
      metadata: Prisma.JsonValue;
    },
  ) {
    const authorizationUrl =
      existing.metadata && typeof existing.metadata === 'object'
        ? ((existing.metadata as Record<string, unknown>).authorizationUrl as string | undefined)
        : undefined;

    if (!authorizationUrl && existing.status === BillingTransactionStatus.PENDING) {
      throw new ConflictException('Checkout already exists for this idempotency key');
    }

    return {
      provider: 'paystack',
      reference: existing.reference,
      authorizationUrl,
      amountMinor: existing.amountMinor,
      currency: existing.currency,
      credits: fromCreditUnits(existing.creditsUnits),
      deduplicated: true,
      status: existing.status,
    };
  }

  private defaultCallbackUrl(organizationId: string, reference: string) {
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    return `${appUrl}/billing-usage?org=${organizationId}&reference=${reference}`;
  }

  private async initializePaystackTransaction(input: {
    reference: string;
    email: string;
    amountMinor: number;
    currency: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
  }) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    }

    const response = await firstValueFrom(
      this.http.post<PaystackInitializeResponse>(
        'https://api.paystack.co/transaction/initialize',
        {
          email: input.email,
          amount: input.amountMinor,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        },
        {
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    if (!response.data?.status || !response.data?.data?.authorization_url) {
      throw new BadRequestException('Failed to initialize Paystack checkout');
    }
    if (response.data.data.reference !== input.reference) {
      throw new BadRequestException('Payment provider reference mismatch');
    }

    return response.data;
  }

  private async verifyPaystackTransaction(reference: string) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    }

    const response = await firstValueFrom(
      this.http.get<PaystackVerifyResponse>(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: { Authorization: `Bearer ${secret}` },
        },
      ),
    );

    if (!response.data?.status) {
      throw new BadRequestException('Unable to verify Paystack transaction');
    }
    if (response.data.data.reference !== reference) {
      throw new BadRequestException('Payment verification reference mismatch');
    }

    return response.data;
  }

  private async chargePaystackAuthorization(input: {
    authorizationCode: string;
    email: string;
    amountMinor: number;
    currency: string;
    reference: string;
  }) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    }

    const response = await firstValueFrom(
      this.http.post<PaystackChargeAuthorizationResponse>(
        'https://api.paystack.co/transaction/charge_authorization',
        {
          authorization_code: input.authorizationCode,
          email: input.email,
          amount: input.amountMinor,
          currency: input.currency,
          reference: input.reference,
        },
        {
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    if (!response.data?.status || !response.data?.data?.reference) {
      throw new BadRequestException('Failed to charge stored payment authorization');
    }
    if (response.data.data.reference !== input.reference) {
      throw new BadRequestException('Renewal charge reference mismatch');
    }

    return response.data;
  }
}
