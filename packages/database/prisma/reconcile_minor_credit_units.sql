BEGIN;

-- Unit-only normalization after legacy whole-credit columns are removed.
UPDATE "Billing"
SET
  "creditBalanceUnits" = GREATEST("creditBalanceUnits", 0),
  "committedMonthlyCreditsUnits" = GREATEST("committedMonthlyCreditsUnits", 0);

UPDATE "BillingTransaction"
SET
  "creditsUnits" = GREATEST("creditsUnits", 0);

COMMIT;
