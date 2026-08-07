-- 50 free comms recipients/month per org (Telegram broadcasts + event announcements), tracked
-- separately from the general credit balance. Use-it-or-lose-it, no rollover — resets whenever
-- commsFreeRecipientsMonthKey no longer matches the current "YYYY-MM".
ALTER TABLE "Billing" ADD COLUMN "commsFreeRecipientsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Billing" ADD COLUMN "commsFreeRecipientsMonthKey" TEXT;
