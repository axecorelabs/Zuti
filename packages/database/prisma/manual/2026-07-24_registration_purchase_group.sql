ALTER TABLE "RegistrationEntry" ADD COLUMN IF NOT EXISTS "purchaseGroupId" TEXT;
CREATE INDEX IF NOT EXISTS "RegistrationEntry_purchaseGroupId_idx" ON "RegistrationEntry" ("purchaseGroupId");
