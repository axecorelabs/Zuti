CREATE TABLE IF NOT EXISTS "RegistrationWaitlistEntry" (
  "id"             TEXT NOT NULL,
  "orgId"          TEXT NOT NULL,
  "productId"      TEXT NOT NULL,
  "ticketTypeId"   TEXT,
  "botId"          TEXT,
  "conversationId" TEXT,
  "customerName"   TEXT,
  "customerEmail"  TEXT NOT NULL,
  "quantity"       INTEGER NOT NULL DEFAULT 1,
  "status"         TEXT NOT NULL DEFAULT 'WAITING',
  "offeredEntryId" TEXT,
  "offerExpiresAt" TIMESTAMP(3),
  "customerId"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RegistrationWaitlistEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RegistrationWaitlistEntry_productId_ticketTypeId_status_createdAt_idx" ON "RegistrationWaitlistEntry" ("productId", "ticketTypeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "RegistrationWaitlistEntry_orgId_idx" ON "RegistrationWaitlistEntry" ("orgId");
CREATE INDEX IF NOT EXISTS "RegistrationWaitlistEntry_customerEmail_idx" ON "RegistrationWaitlistEntry" ("customerEmail");
