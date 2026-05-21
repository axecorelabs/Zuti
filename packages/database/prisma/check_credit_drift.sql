-- Unit-only consistency checks.
SELECT
  'BillingNegativeUnits' AS check_name,
  COUNT(*)::bigint AS issue_rows
FROM "Billing"
WHERE "creditBalanceUnits" < 0 OR "committedMonthlyCreditsUnits" < 0

UNION ALL

SELECT
  'BillingTransactionNegativeUnits' AS check_name,
  COUNT(*)::bigint AS issue_rows
FROM "BillingTransaction"
WHERE "creditsUnits" < 0

UNION ALL

SELECT
  'CreditLedgerOverdrawnBalance' AS check_name,
  COUNT(*)::bigint AS issue_rows
FROM "CreditLedger"
WHERE "balanceAfterUnits" < 0;
