ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "category" TEXT;

CREATE INDEX IF NOT EXISTS "RegistrationProduct_category_idx" ON "RegistrationProduct" ("category");
CREATE INDEX IF NOT EXISTS "RegistrationProduct_city_idx" ON "RegistrationProduct" ("city");
