-- Add WhatsApp channel support across bot, conversation, and routing enums
ALTER TYPE "BotPrimaryChannel" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "ConversationChannel" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "ContactChannel" ADD VALUE IF NOT EXISTS 'WHATSAPP';
DO $$ BEGIN
	CREATE TYPE "WhatsAppProvider" AS ENUM ('META', 'TWILIO');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
	CREATE TYPE "WhatsAppIntegrationMode" AS ENUM ('META_EMBEDDED_SIGNUP', 'META_MANUAL', 'TWILIO');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Bot"
ADD COLUMN IF NOT EXISTS "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "whatsappProvider" "WhatsAppProvider",
ADD COLUMN IF NOT EXISTS "whatsappIntegrationMode" "WhatsAppIntegrationMode",
ADD COLUMN IF NOT EXISTS "whatsappChannelIdentifier" TEXT,
ADD COLUMN IF NOT EXISTS "whatsappPhoneNumber" TEXT,
ADD COLUMN IF NOT EXISTS "whatsappDisplayName" TEXT,
ADD COLUMN IF NOT EXISTS "whatsappVerifyToken" TEXT,
ADD COLUMN IF NOT EXISTS "whatsappConfig" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "whatsappUserId" TEXT,
ADD COLUMN IF NOT EXISTS "whatsappPhoneNumber" TEXT,
ADD COLUMN IF NOT EXISTS "whatsappProfileName" TEXT;

ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "whatsappMsgId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Bot_whatsappChannelIdentifier_key" ON "Bot"("whatsappChannelIdentifier");
CREATE INDEX IF NOT EXISTS "Conversation_botId_whatsappUserId_idx" ON "Conversation"("botId", "whatsappUserId");
CREATE INDEX IF NOT EXISTS "Conversation_botId_whatsappPhoneNumber_idx" ON "Conversation"("botId", "whatsappPhoneNumber");
