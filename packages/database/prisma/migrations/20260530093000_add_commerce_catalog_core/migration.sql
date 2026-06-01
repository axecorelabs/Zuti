-- Core commerce catalog + multi-location inventory models for AI-native product grounding.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommerceCurrency') THEN
    CREATE TYPE "CommerceCurrency" AS ENUM ('NGN', 'USD');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CommerceStore" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" "CommerceCurrency" NOT NULL DEFAULT 'NGN',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceStore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommerceLocation" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "address" JSONB NOT NULL DEFAULT '{}',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommerceProduct" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommerceVariant" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "title" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "priceMinor" INTEGER NOT NULL,
  "currency" "CommerceCurrency" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommerceInventoryLevel" (
  "id" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "onHand" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "reorderPoint" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceInventoryLevel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommerceStore_organizationId_isActive_idx" ON "CommerceStore"("organizationId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceLocation_storeId_code_key" ON "CommerceLocation"("storeId", "code");
CREATE INDEX IF NOT EXISTS "CommerceLocation_storeId_isActive_priority_idx" ON "CommerceLocation"("storeId", "isActive", "priority");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceProduct_storeId_slug_key" ON "CommerceProduct"("storeId", "slug");
CREATE INDEX IF NOT EXISTS "CommerceProduct_storeId_isActive_createdAt_idx" ON "CommerceProduct"("storeId", "isActive", "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceVariant_productId_sku_key" ON "CommerceVariant"("productId", "sku");
CREATE INDEX IF NOT EXISTS "CommerceVariant_productId_isActive_idx" ON "CommerceVariant"("productId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceInventoryLevel_variantId_locationId_key" ON "CommerceInventoryLevel"("variantId", "locationId");
CREATE INDEX IF NOT EXISTS "CommerceInventoryLevel_locationId_idx" ON "CommerceInventoryLevel"("locationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CommerceStore_organizationId_fkey'
  ) THEN
    ALTER TABLE "CommerceStore"
      ADD CONSTRAINT "CommerceStore_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CommerceLocation_storeId_fkey'
  ) THEN
    ALTER TABLE "CommerceLocation"
      ADD CONSTRAINT "CommerceLocation_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "CommerceStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CommerceProduct_storeId_fkey'
  ) THEN
    ALTER TABLE "CommerceProduct"
      ADD CONSTRAINT "CommerceProduct_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "CommerceStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CommerceVariant_productId_fkey'
  ) THEN
    ALTER TABLE "CommerceVariant"
      ADD CONSTRAINT "CommerceVariant_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CommerceInventoryLevel_variantId_fkey'
  ) THEN
    ALTER TABLE "CommerceInventoryLevel"
      ADD CONSTRAINT "CommerceInventoryLevel_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "CommerceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CommerceInventoryLevel_locationId_fkey'
  ) THEN
    ALTER TABLE "CommerceInventoryLevel"
      ADD CONSTRAINT "CommerceInventoryLevel_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "CommerceLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
