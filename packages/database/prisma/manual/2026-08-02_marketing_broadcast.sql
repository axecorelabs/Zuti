CREATE TABLE IF NOT EXISTS "MarketingBroadcast" (
  "id"                TEXT NOT NULL,
  "orgId"             TEXT NOT NULL,
  "botId"             TEXT NOT NULL,
  "eventId"           TEXT,
  "message"           TEXT NOT NULL,
  "imageUrl"          TEXT,
  "ctaLabel"          TEXT,
  "ctaUrl"            TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  "amountMinor"       INTEGER NOT NULL DEFAULT 0,
  "paystackReference" TEXT,
  "paidAt"            TIMESTAMP(3),
  "recipientCount"    INTEGER NOT NULL DEFAULT 0,
  "sentCount"         INTEGER NOT NULL DEFAULT 0,
  "failedCount"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingBroadcast_paystackReference_key" ON "MarketingBroadcast" ("paystackReference");

DO $$ BEGIN
  ALTER TABLE "MarketingBroadcast" ADD CONSTRAINT "MarketingBroadcast_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "MarketingBroadcast_orgId_createdAt_idx" ON "MarketingBroadcast" ("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingBroadcast_botId_status_idx" ON "MarketingBroadcast" ("botId", "status");
