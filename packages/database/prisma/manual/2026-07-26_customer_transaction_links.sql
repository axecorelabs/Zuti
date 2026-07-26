-- Customer Hub Stage 2C. Additive: nullable customerId back-link on the transaction models so a
-- customer's profile can show purchases/registrations/bookings, not just conversations.

ALTER TABLE "SalesOrder"        ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "Booking"           ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "CommerceOrder"     ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "RegistrationEntry" ADD COLUMN IF NOT EXISTS "customerId" TEXT;

DO $$ BEGIN ALTER TABLE "SalesOrder"        ADD CONSTRAINT "SalesOrder_customerId_fkey"        FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Booking"           ADD CONSTRAINT "Booking_customerId_fkey"           FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CommerceOrder"     ADD CONSTRAINT "CommerceOrder_customerId_fkey"     FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RegistrationEntry" ADD CONSTRAINT "RegistrationEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "SalesOrder_customerId_idx"        ON "SalesOrder" ("customerId");
CREATE INDEX IF NOT EXISTS "Booking_customerId_idx"           ON "Booking" ("customerId");
CREATE INDEX IF NOT EXISTS "CommerceOrder_customerId_idx"     ON "CommerceOrder" ("customerId");
CREATE INDEX IF NOT EXISTS "RegistrationEntry_customerId_idx" ON "RegistrationEntry" ("customerId");
