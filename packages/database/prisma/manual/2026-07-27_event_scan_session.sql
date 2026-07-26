-- Temporary public, event-scoped check-in links (scan sessions).
CREATE TABLE IF NOT EXISTS "EventScanSession" (
  "id"         TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "productId"  TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "label"      TEXT,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "revokedAt"  TIMESTAMP(3),
  "createdBy"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventScanSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventScanSession_token_key" ON "EventScanSession" ("token");
CREATE INDEX IF NOT EXISTS "EventScanSession_productId_idx" ON "EventScanSession" ("productId");
CREATE INDEX IF NOT EXISTS "EventScanSession_orgId_idx" ON "EventScanSession" ("orgId");

DO $$ BEGIN
  ALTER TABLE "EventScanSession"
    ADD CONSTRAINT "EventScanSession_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "RegistrationProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
