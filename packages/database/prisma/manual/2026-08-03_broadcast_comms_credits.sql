-- Marketing broadcasts moved from a flat Paystack-per-send fee to the shared comms-credits
-- system (50 free recipients/month, then 10 units/₦1 per recipient). These track what was
-- actually charged for each broadcast, replacing amountMinor/paystackReference going forward.
ALTER TABLE "MarketingBroadcast" ADD COLUMN "creditsChargedUnits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketingBroadcast" ADD COLUMN "freeRecipientsApplied" INTEGER NOT NULL DEFAULT 0;
