-- CreateEnum
CREATE TYPE "BotTemplate" AS ENUM ('GENERAL', 'SALES', 'SUPPORT', 'BOOKING', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "ContactPolicyScope" AS ENUM ('ORGANIZATION', 'BOT');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('TELEGRAM', 'EMAIL');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('MEETING_REQUEST', 'SALES_ORDER_REQUEST', 'OWNER_ATTENTION_NEEDED', 'TECHNICAL_ISSUE');

-- CreateEnum
CREATE TYPE "ActionTaskStatus" AS ENUM ('DETECTED', 'PENDING_CONFIRMATION', 'QUEUED', 'ROUTED', 'SENT', 'DELIVERED', 'ACKNOWLEDGED', 'COMPLETED', 'FAILED', 'CONFIGURATION_NEEDED');

-- CreateEnum
CREATE TYPE "ActionDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RETRYING', 'ACKNOWLEDGED');

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "actionForwardingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "capabilities" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "template" "BotTemplate" NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE "ContactEndpoint" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "userId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "botId" TEXT,
    "name" TEXT NOT NULL,
    "scope" "ContactPolicyScope" NOT NULL DEFAULT 'ORGANIZATION',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "endpointId" TEXT,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionTask" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourceMessageId" TEXT,
    "actionType" "ActionType" NOT NULL,
    "status" "ActionTaskStatus" NOT NULL DEFAULT 'DETECTED',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION,
    "dedupeKey" TEXT,
    "routedPolicyId" TEXT,
    "assignedEndpointId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionDelivery" (
    "id" TEXT NOT NULL,
    "actionTaskId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "endpointId" TEXT,
    "channel" "ContactChannel" NOT NULL,
    "status" "ActionDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestPayload" JSONB NOT NULL DEFAULT '{}',
    "responsePayload" JSONB NOT NULL DEFAULT '{}',
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "actionTaskId" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "interest" TEXT,
    "budget" TEXT,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "actionTaskId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "product" TEXT,
    "quantity" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalIssue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "actionTaskId" TEXT NOT NULL,
    "reporterName" TEXT,
    "reporterEmail" TEXT,
    "reporterPhone" TEXT,
    "issueCategory" TEXT,
    "severity" TEXT,
    "summary" TEXT,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicalIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactEndpoint_orgId_isActive_channel_idx" ON "ContactEndpoint"("orgId", "isActive", "channel");

-- CreateIndex
CREATE INDEX "ContactEndpoint_orgId_userId_isActive_idx" ON "ContactEndpoint"("orgId", "userId", "isActive");

-- CreateIndex
CREATE INDEX "ContactPolicy_orgId_scope_isDefault_idx" ON "ContactPolicy"("orgId", "scope", "isDefault");

-- CreateIndex
CREATE INDEX "ContactPolicy_orgId_botId_idx" ON "ContactPolicy"("orgId", "botId");

-- CreateIndex
CREATE INDEX "ActionTask_orgId_status_createdAt_idx" ON "ActionTask"("orgId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActionTask_orgId_actionType_createdAt_idx" ON "ActionTask"("orgId", "actionType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActionTask_orgId_assignedEndpointId_status_createdAt_idx" ON "ActionTask"("orgId", "assignedEndpointId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ActionTask_orgId_dedupeKey_key" ON "ActionTask"("orgId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ActionDelivery_orgId_status_createdAt_idx" ON "ActionDelivery"("orgId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActionDelivery_actionTaskId_attempt_idx" ON "ActionDelivery"("actionTaskId", "attempt");

-- CreateIndex
CREATE INDEX "ActionDelivery_orgId_channel_status_idx" ON "ActionDelivery"("orgId", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_actionTaskId_key" ON "Lead"("actionTaskId");

-- CreateIndex
CREATE INDEX "Lead_orgId_createdAt_idx" ON "Lead"("orgId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lead_orgId_email_idx" ON "Lead"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_actionTaskId_key" ON "SalesOrder"("actionTaskId");

-- CreateIndex
CREATE INDEX "SalesOrder_orgId_status_createdAt_idx" ON "SalesOrder"("orgId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SalesOrder_orgId_customerEmail_idx" ON "SalesOrder"("orgId", "customerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalIssue_actionTaskId_key" ON "TechnicalIssue"("actionTaskId");

-- CreateIndex
CREATE INDEX "TechnicalIssue_orgId_severity_status_createdAt_idx" ON "TechnicalIssue"("orgId", "severity", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TechnicalIssue_orgId_reporterEmail_idx" ON "TechnicalIssue"("orgId", "reporterEmail");

-- AddForeignKey
ALTER TABLE "ContactEndpoint" ADD CONSTRAINT "ContactEndpoint_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPolicy" ADD CONSTRAINT "ContactPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPolicy" ADD CONSTRAINT "ContactPolicy_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPolicy" ADD CONSTRAINT "ContactPolicy_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ContactEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTask" ADD CONSTRAINT "ActionTask_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTask" ADD CONSTRAINT "ActionTask_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTask" ADD CONSTRAINT "ActionTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTask" ADD CONSTRAINT "ActionTask_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTask" ADD CONSTRAINT "ActionTask_routedPolicyId_fkey" FOREIGN KEY ("routedPolicyId") REFERENCES "ContactPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTask" ADD CONSTRAINT "ActionTask_assignedEndpointId_fkey" FOREIGN KEY ("assignedEndpointId") REFERENCES "ContactEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDelivery" ADD CONSTRAINT "ActionDelivery_actionTaskId_fkey" FOREIGN KEY ("actionTaskId") REFERENCES "ActionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDelivery" ADD CONSTRAINT "ActionDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDelivery" ADD CONSTRAINT "ActionDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ContactEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_actionTaskId_fkey" FOREIGN KEY ("actionTaskId") REFERENCES "ActionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_actionTaskId_fkey" FOREIGN KEY ("actionTaskId") REFERENCES "ActionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalIssue" ADD CONSTRAINT "TechnicalIssue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalIssue" ADD CONSTRAINT "TechnicalIssue_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalIssue" ADD CONSTRAINT "TechnicalIssue_actionTaskId_fkey" FOREIGN KEY ("actionTaskId") REFERENCES "ActionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
