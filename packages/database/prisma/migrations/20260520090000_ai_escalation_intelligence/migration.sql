-- CreateEnum
CREATE TYPE "KnowledgeSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED');

-- CreateEnum
CREATE TYPE "EscalationThreadStatus" AS ENUM ('OPEN', 'ANSWERED', 'RESOLVED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "AiUsageType" AS ENUM ('CUSTOMER_REPLY', 'ESCALATION_ANALYSIS', 'KNOWLEDGE_SUGGESTION', 'INTERNAL_ASSISTANT', 'SUMMARIZATION');

-- CreateTable
CREATE TABLE "EscalationThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "escalationId" TEXT,
    "teamChatMessageId" TEXT,
    "assignedUserId" TEXT,
    "topic" TEXT,
    "question" TEXT NOT NULL,
    "status" "EscalationThreadStatus" NOT NULL DEFAULT 'OPEN',
    "duplicateCount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationThreadReply" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationThreadReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "threadId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceQuestion" TEXT,
    "sourceAnswer" TEXT,
    "status" "KnowledgeSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botId" TEXT,
    "conversationId" TEXT,
    "usageType" "AiUsageType" NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscalationThread_escalationId_key" ON "EscalationThread"("escalationId");

-- CreateIndex
CREATE INDEX "EscalationThread_organizationId_status_createdAt_idx" ON "EscalationThread"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EscalationThread_assignedUserId_status_idx" ON "EscalationThread"("assignedUserId", "status");

-- CreateIndex
CREATE INDEX "EscalationThread_conversationId_idx" ON "EscalationThread"("conversationId");

-- CreateIndex
CREATE INDEX "EscalationThreadReply_threadId_createdAt_idx" ON "EscalationThreadReply"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "EscalationThreadReply_authorId_idx" ON "EscalationThreadReply"("authorId");

-- CreateIndex
CREATE INDEX "KnowledgeSuggestion_organizationId_status_createdAt_idx" ON "KnowledgeSuggestion"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeSuggestion_threadId_idx" ON "KnowledgeSuggestion"("threadId");

-- CreateIndex
CREATE INDEX "AiUsageEvent_organizationId_usageType_createdAt_idx" ON "AiUsageEvent"("organizationId", "usageType", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_conversationId_idx" ON "AiUsageEvent"("conversationId");

-- AddForeignKey
ALTER TABLE "EscalationThread" ADD CONSTRAINT "EscalationThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationThread" ADD CONSTRAINT "EscalationThread_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationThread" ADD CONSTRAINT "EscalationThread_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "Escalation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationThread" ADD CONSTRAINT "EscalationThread_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationThreadReply" ADD CONSTRAINT "EscalationThreadReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EscalationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationThreadReply" ADD CONSTRAINT "EscalationThreadReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSuggestion" ADD CONSTRAINT "KnowledgeSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSuggestion" ADD CONSTRAINT "KnowledgeSuggestion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSuggestion" ADD CONSTRAINT "KnowledgeSuggestion_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EscalationThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSuggestion" ADD CONSTRAINT "KnowledgeSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
