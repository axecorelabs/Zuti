ALTER TABLE "RegistrationEntry" ADD COLUMN IF NOT EXISTS "checkInCode" TEXT;
ALTER TABLE "RegistrationEntry" ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationEntry_checkInCode_key" ON "RegistrationEntry" ("checkInCode");
