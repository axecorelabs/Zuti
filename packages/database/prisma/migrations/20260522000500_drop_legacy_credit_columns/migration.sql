-- Finalize minor-unit cutover by dropping legacy whole-credit columns.

-- Safety backfill before dropping old columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Billing' AND column_name = 'creditBalance'
  ) THEN
    EXECUTE '
      UPDATE "Billing"
      SET
        "creditBalanceUnits" = CASE
          WHEN "creditBalanceUnits" = 0 AND "creditBalance" <> 0 THEN "creditBalance" * 100
          ELSE "creditBalanceUnits"
        END,
        "committedMonthlyCreditsUnits" = CASE
          WHEN "committedMonthlyCreditsUnits" = 0 AND "committedMonthlyCredits" <> 0 THEN "committedMonthlyCredits" * 100
          ELSE "committedMonthlyCreditsUnits"
        END
    ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CreditLedger' AND column_name = 'creditsDelta'
  ) THEN
    EXECUTE '
      UPDATE "CreditLedger"
      SET
        "creditsDeltaUnits" = CASE
          WHEN "creditsDeltaUnits" = 0 AND "creditsDelta" <> 0 THEN "creditsDelta" * 100
          ELSE "creditsDeltaUnits"
        END,
        "balanceAfterUnits" = CASE
          WHEN "balanceAfterUnits" = 0 AND "balanceAfter" <> 0 THEN "balanceAfter" * 100
          ELSE "balanceAfterUnits"
        END
    ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'BillingTransaction' AND column_name = 'credits'
  ) THEN
    EXECUTE '
      UPDATE "BillingTransaction"
      SET
        "creditsUnits" = CASE
          WHEN "creditsUnits" = 0 AND "credits" <> 0 THEN "credits" * 100
          ELSE "creditsUnits"
        END
    ';
  END IF;
END
$$;

ALTER TABLE "Billing"
  DROP COLUMN IF EXISTS "creditBalance",
  DROP COLUMN IF EXISTS "committedMonthlyCredits";

ALTER TABLE "CreditLedger"
  DROP COLUMN IF EXISTS "creditsDelta",
  DROP COLUMN IF EXISTS "balanceAfter";

ALTER TABLE "BillingTransaction"
  DROP COLUMN IF EXISTS "credits";
