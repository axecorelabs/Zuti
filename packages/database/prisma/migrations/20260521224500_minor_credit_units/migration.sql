-- Add minor credit unit columns for fractional credit accounting.
-- This migration is written defensively because some environments were synced via db push.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'creditledgertype') THEN
    CREATE TYPE "CreditLedgerType" AS ENUM ('GRANT', 'PURCHASE', 'USAGE', 'ADJUSTMENT', 'REFUND', 'COMMITMENT_ALLOCATION');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paymentprovider') THEN
    CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billingtransactionkind') THEN
    CREATE TYPE "BillingTransactionKind" AS ENUM ('CREDIT_PACK', 'COMMITMENT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billingtransactionstatus') THEN
    CREATE TYPE "BillingTransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "BillingTransaction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "billingId" TEXT NOT NULL,
  "initiatedById" TEXT,
  "idempotencyKey" TEXT,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
  "reference" TEXT NOT NULL,
  "kind" "BillingTransactionKind" NOT NULL,
  "status" "BillingTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "credits" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CreditLedger" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "billingId" TEXT NOT NULL,
  "transactionId" TEXT,
  "type" "CreditLedgerType" NOT NULL,
  "creditsDelta" INTEGER NOT NULL DEFAULT 0,
  "balanceAfter" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingTransaction_reference_key" ON "BillingTransaction"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "BillingTransaction_idempotencyKey_key" ON "BillingTransaction"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "CreditLedger_idempotencyKey_key" ON "CreditLedger"("idempotencyKey");

ALTER TABLE "Billing"
  ADD COLUMN IF NOT EXISTS "creditBalanceUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "committedMonthlyCreditsUnits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CreditLedger"
  ADD COLUMN IF NOT EXISTS "creditsDeltaUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balanceAfterUnits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BillingTransaction"
  ADD COLUMN IF NOT EXISTS "creditsUnits" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing records from whole-credit fields when those legacy columns exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Billing' AND column_name = 'creditBalance'
  ) THEN
    EXECUTE 'UPDATE "Billing" SET "creditBalanceUnits" = "creditBalance" * 100';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Billing' AND column_name = 'committedMonthlyCredits'
  ) THEN
    EXECUTE 'UPDATE "Billing" SET "committedMonthlyCreditsUnits" = "committedMonthlyCredits" * 100';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CreditLedger' AND column_name = 'creditsDelta'
  ) THEN
    EXECUTE 'UPDATE "CreditLedger" SET "creditsDeltaUnits" = "creditsDelta" * 100';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CreditLedger' AND column_name = 'balanceAfter'
  ) THEN
    EXECUTE 'UPDATE "CreditLedger" SET "balanceAfterUnits" = "balanceAfter" * 100';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'BillingTransaction' AND column_name = 'credits'
  ) THEN
    EXECUTE 'UPDATE "BillingTransaction" SET "creditsUnits" = "credits" * 100';
  END IF;
END
$$;
