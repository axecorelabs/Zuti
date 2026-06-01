-- Add commerce orders and payments for ecommerce checkout flow.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommerceOrderStatus') THEN
    CREATE TYPE "CommerceOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommercePaymentProvider') THEN
    CREATE TYPE "CommercePaymentProvider" AS ENUM ('PAYSTACK');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommercePaymentStatus') THEN
    CREATE TYPE "CommercePaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CommerceOrder" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "customerName" TEXT,
  "customerEmail" TEXT,
  "customerPhone" TEXT,
  "deliveryAddress" TEXT,
  "notes" TEXT,
  "currency" "CommerceCurrency" NOT NULL,
  "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "status" "CommerceOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "paymentStatus" "CommercePaymentStatus" NOT NULL DEFAULT 'PENDING',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommerceOrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "locationId" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitPriceMinor" INTEGER NOT NULL,
  "lineTotalMinor" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommercePayment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" "CommercePaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
  "reference" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" "CommerceCurrency" NOT NULL,
  "status" "CommercePaymentStatus" NOT NULL DEFAULT 'PENDING',
  "authorizationUrl" TEXT,
  "paidAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercePayment_reference_key" ON "CommercePayment"("reference");
CREATE INDEX IF NOT EXISTS "CommerceOrder_organizationId_status_createdAt_idx" ON "CommerceOrder"("organizationId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CommerceOrder_storeId_status_createdAt_idx" ON "CommerceOrder"("storeId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CommerceOrderItem_orderId_idx" ON "CommerceOrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "CommerceOrderItem_variantId_idx" ON "CommerceOrderItem"("variantId");
CREATE INDEX IF NOT EXISTS "CommerceOrderItem_locationId_idx" ON "CommerceOrderItem"("locationId");
CREATE INDEX IF NOT EXISTS "CommercePayment_organizationId_status_createdAt_idx" ON "CommercePayment"("organizationId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CommercePayment_orderId_status_createdAt_idx" ON "CommercePayment"("orderId", "status", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommerceOrder_organizationId_fkey') THEN
    ALTER TABLE "CommerceOrder"
      ADD CONSTRAINT "CommerceOrder_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommerceOrder_storeId_fkey') THEN
    ALTER TABLE "CommerceOrder"
      ADD CONSTRAINT "CommerceOrder_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "CommerceStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommerceOrderItem_orderId_fkey') THEN
    ALTER TABLE "CommerceOrderItem"
      ADD CONSTRAINT "CommerceOrderItem_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommerceOrderItem_variantId_fkey') THEN
    ALTER TABLE "CommerceOrderItem"
      ADD CONSTRAINT "CommerceOrderItem_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "CommerceVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommerceOrderItem_locationId_fkey') THEN
    ALTER TABLE "CommerceOrderItem"
      ADD CONSTRAINT "CommerceOrderItem_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "CommerceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommercePayment_organizationId_fkey') THEN
    ALTER TABLE "CommercePayment"
      ADD CONSTRAINT "CommercePayment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommercePayment_orderId_fkey') THEN
    ALTER TABLE "CommercePayment"
      ADD CONSTRAINT "CommercePayment_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
