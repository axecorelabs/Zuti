-- Org-level payout account (Paystack subaccount) for ticket & product sales settlement.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "paystackSubaccountCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "payoutBusinessName" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "payoutBankName" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "payoutAccountLast4" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "payoutAccountName" TEXT;
