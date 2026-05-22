/*
  Warnings:

  - A unique constraint covering the columns `[emailAddress]` on the table `Bot` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WIDGET', 'TELEGRAM', 'EMAIL');

-- AlterEnum
ALTER TYPE "BotPrimaryChannel" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "Billing" ADD COLUMN     "commitmentRenewsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "customEmailAddress" TEXT,
ADD COLUMN     "customEmailDomain" TEXT,
ADD COLUMN     "customEmailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailAddress" TEXT,
ADD COLUMN     "emailEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channel" "ConversationChannel" NOT NULL DEFAULT 'WIDGET',
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "emailSubject" TEXT,
ADD COLUMN     "emailThreadId" TEXT;

-- CreateTable
CREATE TABLE "CannedResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamChatMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CannedResponse_organizationId_idx" ON "CannedResponse"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CannedResponse_organizationId_shortcut_key" ON "CannedResponse"("organizationId", "shortcut");

-- CreateIndex
CREATE INDEX "TeamChatMessage_organizationId_createdAt_idx" ON "TeamChatMessage"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TeamChatMessage_senderId_idx" ON "TeamChatMessage"("senderId");

-- CreateIndex
CREATE INDEX "ActivityLog_orgId_targetType_targetId_action_createdAt_idx" ON "ActivityLog"("orgId", "targetType", "targetId", "action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BillingTransaction_organizationId_status_createdAt_idx" ON "BillingTransaction"("organizationId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BillingTransaction_organizationId_initiatedById_kind_create_idx" ON "BillingTransaction"("organizationId", "initiatedById", "kind", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Bot_emailAddress_key" ON "Bot"("emailAddress");

-- CreateIndex
CREATE INDEX "Conversation_botId_customerEmail_idx" ON "Conversation"("botId", "customerEmail");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_lastMessageAt_idx" ON "Conversation"("organizationId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_organizationId_status_lastMessageAt_idx" ON "Conversation"("organizationId", "status", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_organizationId_assignedAgentId_lastMessageAt_idx" ON "Conversation"("organizationId", "assignedAgentId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_organizationId_assignedAgentId_mode_status_idx" ON "Conversation"("organizationId", "assignedAgentId", "mode", "status");

-- CreateIndex
CREATE INDEX "CreditLedger_organizationId_createdAt_idx" ON "CreditLedger"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CreditLedger_billingId_createdAt_idx" ON "CreditLedger"("billingId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_role_createdAt_idx" ON "Message"("conversationId", "role", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_orgId_targetUserId_isRead_createdAt_idx" ON "Notification"("orgId", "targetUserId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_role_isAvailable_idx" ON "OrganizationMember"("organizationId", "role", "isAvailable");

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BillingTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingTransaction" ADD CONSTRAINT "BillingTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingTransaction" ADD CONSTRAINT "BillingTransaction_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingTransaction" ADD CONSTRAINT "BillingTransaction_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CannedResponse" ADD CONSTRAINT "CannedResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
