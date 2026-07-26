-- Customer Hub — Stage 1. Additive: new tables + a nullable Conversation.customerId back-link.
-- Safe to run on the shared DB; existing flows are untouched until wiring lands. See CUSTOMER_HUB_PLAN.md.

-- Enums
DO $$ BEGIN
  CREATE TYPE "CustomerLifecycle" AS ENUM ('LEAD', 'ENGAGED', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IdentifierType" AS ENUM ('TELEGRAM_CHAT', 'WHATSAPP_PHONE', 'EMAIL', 'PHONE', 'WIDGET_SESSION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Customer
CREATE TABLE IF NOT EXISTS "Customer" (
  "id"                 TEXT PRIMARY KEY,
  "orgId"              TEXT NOT NULL,
  "displayName"        TEXT,
  "primaryEmail"       TEXT,
  "primaryPhone"       TEXT,
  "lifecycleStage"     "CustomerLifecycle" NOT NULL DEFAULT 'LEAD',
  "tags"               TEXT[] NOT NULL DEFAULT '{}',
  "notes"              TEXT,
  "emailOptOut"        BOOLEAN NOT NULL DEFAULT false,
  "marketingConsentAt" TIMESTAMP(3),
  "firstSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Customer_orgId_lifecycleStage_lastSeenAt_idx" ON "Customer" ("orgId", "lifecycleStage", "lastSeenAt" DESC);
CREATE INDEX IF NOT EXISTS "Customer_orgId_primaryEmail_idx" ON "Customer" ("orgId", "primaryEmail");
CREATE INDEX IF NOT EXISTS "Customer_orgId_lastSeenAt_idx" ON "Customer" ("orgId", "lastSeenAt" DESC);

-- CustomerIdentifier
CREATE TABLE IF NOT EXISTS "CustomerIdentifier" (
  "id"         TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "type"       "IdentifierType" NOT NULL,
  "value"      TEXT NOT NULL,
  "isAnchor"   BOOLEAN NOT NULL DEFAULT true,
  "verifiedAt" TIMESTAMP(3),
  "source"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerIdentifier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerIdentifier_orgId_type_value_key" ON "CustomerIdentifier" ("orgId", "type", "value");
CREATE INDEX IF NOT EXISTS "CustomerIdentifier_customerId_idx" ON "CustomerIdentifier" ("customerId");

-- Conversation back-link
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Conversation_customerId_idx" ON "Conversation" ("customerId");
