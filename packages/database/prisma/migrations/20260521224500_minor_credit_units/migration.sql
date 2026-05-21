-- Add minor credit unit columns for fractional credit accounting.
ALTER TABLE "Billing"
  ADD COLUMN "creditBalanceUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "committedMonthlyCreditsUnits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CreditLedger"
  ADD COLUMN "creditsDeltaUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "balanceAfterUnits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BillingTransaction"
  ADD COLUMN "creditsUnits" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing records from whole-credit fields.
UPDATE "Billing"
SET
  "creditBalanceUnits" = "creditBalance" * 100,
  "committedMonthlyCreditsUnits" = "committedMonthlyCredits" * 100;

UPDATE "CreditLedger"
SET
  "creditsDeltaUnits" = "creditsDelta" * 100,
  "balanceAfterUnits" = "balanceAfter" * 100;

UPDATE "BillingTransaction"
SET
  "creditsUnits" = "credits" * 100;
