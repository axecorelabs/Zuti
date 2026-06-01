-- DropIndex
DROP INDEX "MessageAttachment_messageId_createdAt_idx";

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_createdAt_idx" ON "MessageAttachment"("messageId", "createdAt" DESC);
