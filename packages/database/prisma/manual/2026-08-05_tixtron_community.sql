-- Tixtron Telegram community system + marketplace-operator foundations (Phase 0).
-- See /Users/aon/.claude/plans/synchronous-rolling-blossom.md for the full plan.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "featuredOrder" INTEGER;
CREATE INDEX IF NOT EXISTS "RegistrationProduct_isFeatured_featuredOrder_idx" ON "RegistrationProduct" ("isFeatured", "featuredOrder");

ALTER TABLE "Billing" ADD COLUMN IF NOT EXISTS "commsAdFreeUnitsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Billing" ADD COLUMN IF NOT EXISTS "commsAdFreeMonthKey" TEXT;

CREATE TABLE IF NOT EXISTS "Community" (
  "id"                   TEXT NOT NULL,
  "orgId"                TEXT,
  "botId"                TEXT NOT NULL,
  "telegramChatId"       TEXT NOT NULL,
  "telegramChatUsername" TEXT,
  "name"                 TEXT NOT NULL,
  "isActive"             BOOLEAN NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Community_orgId_key" ON "Community" ("orgId");
CREATE INDEX IF NOT EXISTS "Community_botId_idx" ON "Community" ("botId");

DO $$ BEGIN
  ALTER TABLE "Community" ADD CONSTRAINT "Community_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Community" ADD CONSTRAINT "Community_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "CommunityMembership" (
  "id"                        TEXT NOT NULL,
  "communityId"               TEXT NOT NULL,
  "telegramChatId"            TEXT NOT NULL,
  "sourceRegistrationEntryId" TEXT,
  "status"                    TEXT NOT NULL DEFAULT 'INVITED',
  "invitedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinedAt"                  TIMESTAMP(3),
  "leftAt"                    TIMESTAMP(3),
  CONSTRAINT "CommunityMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityMembership_communityId_telegramChatId_key" ON "CommunityMembership" ("communityId", "telegramChatId");
CREATE INDEX IF NOT EXISTS "CommunityMembership_communityId_status_idx" ON "CommunityMembership" ("communityId", "status");

DO $$ BEGIN
  ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "PromotionalPost" (
  "id"                TEXT NOT NULL,
  "orgId"             TEXT NOT NULL,
  "communityId"       TEXT NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "body"              TEXT NOT NULL,
  "mediaUrl"          TEXT,
  "ctaLabel"          TEXT,
  "ctaUrl"            TEXT,
  "status"            TEXT NOT NULL DEFAULT 'SUBMITTED',
  "priceCreditsUnits" INTEGER NOT NULL DEFAULT 0,
  "freeUnitsApplied"  INTEGER NOT NULL DEFAULT 0,
  "scheduledFor"      TIMESTAMP(3),
  "reviewedByUserId"  TEXT,
  "reviewedAt"        TIMESTAMP(3),
  "rejectionReason"   TEXT,
  "postedMessageId"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionalPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PromotionalPost_orgId_createdAt_idx" ON "PromotionalPost" ("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "PromotionalPost_communityId_status_idx" ON "PromotionalPost" ("communityId", "status");

DO $$ BEGIN
  ALTER TABLE "PromotionalPost" ADD CONSTRAINT "PromotionalPost_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "PromotionalPost" ADD CONSTRAINT "PromotionalPost_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
