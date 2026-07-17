-- Add REGISTRATION_REQUEST to ActionType enum
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'REGISTRATION_REQUEST';

-- Add RegistrationEntryStatus enum
CREATE TYPE "RegistrationEntryStatus" AS ENUM ('PENDING_PAYMENT', 'AWAITING_APPROVAL', 'CONFIRMED', 'CANCELLED');

-- Create RegistrationProduct table
CREATE TABLE "RegistrationProduct" (
    "id"                  TEXT NOT NULL,
    "orgId"               TEXT NOT NULL,
    "botId"               TEXT,
    "name"                TEXT NOT NULL,
    "description"         TEXT,
    "eventDate"           TIMESTAMP(3),
    "capacity"            INTEGER,
    "isFree"              BOOLEAN NOT NULL DEFAULT true,
    "priceMinor"          INTEGER,
    "currency"            TEXT NOT NULL DEFAULT 'NGN',
    "requiresApproval"    BOOLEAN NOT NULL DEFAULT false,
    "confirmationMessage" TEXT,
    "fields"              JSONB NOT NULL DEFAULT '[]',
    "isActive"            BOOLEAN NOT NULL DEFAULT true,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationProduct_pkey" PRIMARY KEY ("id")
);

-- Create RegistrationEntry table
CREATE TABLE "RegistrationEntry" (
    "id"                 TEXT NOT NULL,
    "productId"          TEXT NOT NULL,
    "orgId"              TEXT NOT NULL,
    "botId"              TEXT,
    "conversationId"     TEXT,
    "actionTaskId"       TEXT,
    "customerName"       TEXT,
    "customerEmail"      TEXT,
    "collectedFields"    JSONB NOT NULL DEFAULT '{}',
    "status"             "RegistrationEntryStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paystackReference"  TEXT,
    "paystackAccessCode" TEXT,
    "paidAt"             TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationEntry_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "RegistrationProduct" ADD CONSTRAINT "RegistrationProduct_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationEntry" ADD CONSTRAINT "RegistrationEntry_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "RegistrationProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationEntry" ADD CONSTRAINT "RegistrationEntry_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "RegistrationProduct_orgId_isActive_idx" ON "RegistrationProduct"("orgId", "isActive");
CREATE INDEX "RegistrationProduct_botId_isActive_idx" ON "RegistrationProduct"("botId", "isActive");
CREATE INDEX "RegistrationEntry_productId_status_idx" ON "RegistrationEntry"("productId", "status");
CREATE INDEX "RegistrationEntry_orgId_status_createdAt_idx" ON "RegistrationEntry"("orgId", "status", "createdAt" DESC);
CREATE INDEX "RegistrationEntry_paystackReference_idx" ON "RegistrationEntry"("paystackReference");
