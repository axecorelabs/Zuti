-- Online/hybrid event support: organizer-provided meeting link, revealed only on the ticket
-- holder's own private ticket page (never on the public event page), gated by CONFIRMED status
-- and a reveal-time window computed in registrations.service.ts.
ALTER TABLE "RegistrationProduct" ADD COLUMN "locationType" TEXT NOT NULL DEFAULT 'PHYSICAL';
ALTER TABLE "RegistrationProduct" ADD COLUMN "onlineMeetingUrl" TEXT;
ALTER TABLE "RegistrationProduct" ADD COLUMN "onlineMeetingPlatform" TEXT;
