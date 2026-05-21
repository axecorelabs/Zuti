-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('OPEN', 'ANSWERED', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "threadId" TEXT,
    "topicKey" TEXT NOT NULL,
    "topic" TEXT,
    "question" TEXT NOT NULL,
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'OPEN',
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGap_organizationId_topicKey_key" ON "KnowledgeGap"("organizationId", "topicKey");

-- CreateIndex
CREATE INDEX "KnowledgeGap_organizationId_status_lastSeenAt_idx" ON "KnowledgeGap"("organizationId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "KnowledgeGap_threadId_idx" ON "KnowledgeGap"("threadId");

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EscalationThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
