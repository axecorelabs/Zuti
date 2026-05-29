-- CreateEnum
DO $$ BEGIN
	CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'AUDIO', 'VOICE', 'VIDEO', 'DOCUMENT', 'FILE', 'OTHER');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "sourceRef" TEXT,
    "url" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "durationSec" INTEGER,
    "caption" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_kind_idx" ON "MessageAttachment"("messageId", "kind");
CREATE INDEX "MessageAttachment_messageId_createdAt_idx" ON "MessageAttachment"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
