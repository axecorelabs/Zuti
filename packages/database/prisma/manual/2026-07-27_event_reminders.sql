-- Automatic transactional reminders: per-event opt-in toggles, per-entry sent-marker, auto flag.
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "reminderBeforeEvent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RegistrationProduct" ADD COLUMN IF NOT EXISTS "reminderUnpaidNudge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RegistrationEntry" ADD COLUMN IF NOT EXISTS "remindersSent" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "EventAnnouncement" ADD COLUMN IF NOT EXISTS "automated" BOOLEAN NOT NULL DEFAULT false;
