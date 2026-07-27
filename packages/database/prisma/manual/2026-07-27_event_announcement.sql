-- Transactional announcements sent to an event's attendees (records + delivery tally).
CREATE TABLE IF NOT EXISTS "EventAnnouncement" (
  "id"              TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "productId"       TEXT NOT NULL,
  "subject"         TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "segment"         TEXT NOT NULL,
  "tierId"          TEXT,
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "sentCount"       INTEGER NOT NULL DEFAULT 0,
  "failedCount"     INTEGER NOT NULL DEFAULT 0,
  "status"          TEXT NOT NULL DEFAULT 'SENDING',
  "sentBy"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EventAnnouncement_productId_idx" ON "EventAnnouncement" ("productId");
CREATE INDEX IF NOT EXISTS "EventAnnouncement_orgId_idx" ON "EventAnnouncement" ("orgId");
