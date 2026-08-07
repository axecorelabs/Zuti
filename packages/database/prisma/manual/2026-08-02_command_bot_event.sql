CREATE TABLE IF NOT EXISTS "CommandBotEvent" (
  "id"         TEXT NOT NULL,
  "botId"      TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "customerId" TEXT,
  "command"    TEXT NOT NULL,
  "resultMeta" JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommandBotEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CommandBotEvent" ADD CONSTRAINT "CommandBotEvent_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "CommandBotEvent_botId_createdAt_idx" ON "CommandBotEvent" ("botId", "createdAt");
CREATE INDEX IF NOT EXISTS "CommandBotEvent_botId_command_idx" ON "CommandBotEvent" ("botId", "command");
