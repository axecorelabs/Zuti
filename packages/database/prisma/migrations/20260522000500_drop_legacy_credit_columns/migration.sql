-- Finalize minor-unit cutover by dropping legacy whole-credit columns.

-- Safety backfill before dropping old columns.
UPDATE "Billing"
SET
  "creditBalanceUnits" = CASE
    WHEN "creditBalanceUnits" = 0 AND "creditBalance" <> 0 THEN "creditBalance" * 100
    ELSE "creditBalanceUnits"
  END,
  "committedMonthlyCreditsUnits" = CASE
    WHEN "committedMonthlyCreditsUnits" = 0 AND "committedMonthlyCredits" <> 0 THEN "committedMonthlyCredits" * 100
    ELSE "committedMonthlyCreditsUnits"
  END;

UPDATE "CreditLedger"
SET
  "creditsDeltaUnits" = CASE
    WHEN "creditsDeltaUnits" = 0 AND "creditsDelta" <> 0 THEN "creditsDelta" * 100
    ELSE "creditsDeltaUnits"
  END,
  "balanceAfterUnits" = CASE
    WHEN "balanceAfterUnits" = 0 AND "balanceAfter" <> 0 THEN "balanceAfter" * 100
    ELSE "balanceAfterUnits"
  END;

UPDATE "BillingTransaction"
SET
  "creditsUnits" = CASE
    WHEN "creditsUnits" = 0 AND "credits" <> 0 THEN "credits" * 100
    ELSE "creditsUnits"
  END;

ALTER TABLE "Billing"
  DROP COLUMN "creditBalance",
  DROP COLUMN "committedMonthlyCredits";

ALTER TABLE "CreditLedger"
  DROP COLUMN "creditsDelta",
  DROP COLUMN "balanceAfter";

ALTER TABLE "BillingTransaction"
  DROP COLUMN "credits";
