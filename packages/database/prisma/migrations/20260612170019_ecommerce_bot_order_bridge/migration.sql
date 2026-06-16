-- Add ECOMMERCE to BotTemplate enum
ALTER TYPE "BotTemplate" ADD VALUE IF NOT EXISTS 'ECOMMERCE';

-- Link Bot to CommerceStore
ALTER TABLE "Bot" ADD COLUMN IF NOT EXISTS "commerceStoreId" TEXT;
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_commerceStoreId_fkey"
  FOREIGN KEY ("commerceStoreId") REFERENCES "CommerceStore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Bot_commerceStoreId_idx" ON "Bot"("commerceStoreId");

-- Make CommerceOrderItem.variantId optional, add lineDescription
ALTER TABLE "CommerceOrderItem" ALTER COLUMN "variantId" DROP NOT NULL;
ALTER TABLE "CommerceOrderItem" ADD COLUMN IF NOT EXISTS "lineDescription" TEXT;

-- Add unitPriceMinor and commerceOrderId to SalesOrder
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "unitPriceMinor" INTEGER;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "commerceOrderId" TEXT;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_commerceOrderId_key" UNIQUE ("commerceOrderId");
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_commerceOrderId_fkey"
  FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
