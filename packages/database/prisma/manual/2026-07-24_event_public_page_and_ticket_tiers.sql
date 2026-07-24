-- Public event page + ticket tiers.
-- Additive and low-risk: one new table, new nullable columns (isPublic gets a constant default =
-- fast metadata-only add in PG11+), and indexes. Names match Prisma's conventions so a later
-- `prisma migrate` reconciles cleanly. The registration tables are small, so plain CREATE INDEX is
-- instant; if they were large, switch the CREATE INDEX lines to CREATE INDEX CONCURRENTLY (outside a
-- transaction). Safe to re-run — every statement guards with IF (NOT) EXISTS.

-- 1) New ticket-tier table (price is authoritative here, like CommerceVariant).
CREATE TABLE IF NOT EXISTS "RegistrationTicketType" (
    "id"          TEXT NOT NULL,
    "productId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "priceMinor"  INTEGER,
    "currency"    TEXT NOT NULL DEFAULT 'NGN',
    "capacity"    INTEGER,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationTicketType_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RegistrationTicketType_productId_isActive_sortOrder_idx"
    ON "RegistrationTicketType" ("productId", "isActive", "sortOrder");

-- 2) Public-page + branding columns on the event.
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "slug"      TEXT;
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "isPublic"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "bannerUrl" TEXT;
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "flierUrl"  TEXT;
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "venue"     TEXT;

-- Global-unique slug for clean public URLs (/e/<slug>). All-null today, so uniqueness is trivial.
CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationProduct_slug_key"
    ON "RegistrationProduct" ("slug");

-- 3) Entry -> chosen tier (nullable; legacy single-price events leave it null).
ALTER TABLE "RegistrationEntry" ADD COLUMN IF NOT EXISTS "ticketTypeId" TEXT;

CREATE INDEX IF NOT EXISTS "RegistrationEntry_ticketTypeId_status_idx"
    ON "RegistrationEntry" ("ticketTypeId", "status");

-- 4) Foreign keys.
DO $$ BEGIN
    ALTER TABLE "RegistrationTicketType"
        ADD CONSTRAINT "RegistrationTicketType_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "RegistrationProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "RegistrationEntry"
        ADD CONSTRAINT "RegistrationEntry_ticketTypeId_fkey"
        FOREIGN KEY ("ticketTypeId") REFERENCES "RegistrationTicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
