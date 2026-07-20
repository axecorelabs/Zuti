-- AlterTable: per-event dedup toggle
ALTER TABLE "RegistrationProduct" ADD COLUMN "allowDuplicateRegistrations" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: ticket quantity + charged amount
ALTER TABLE "RegistrationEntry" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RegistrationEntry" ADD COLUMN "amountMinor" INTEGER;

-- CreateIndex: fast dedup lookup by product + email + status
CREATE INDEX "RegistrationEntry_productId_customerEmail_status_idx" ON "RegistrationEntry"("productId", "customerEmail", "status");
