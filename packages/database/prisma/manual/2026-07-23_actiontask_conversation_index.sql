-- Adds the conversation-led index the agentic order path needs (activeConversationTask lookup in
-- action-forwarding). All existing ActionTask indexes lead with orgId, so a single-conversation
-- lookup scanned every task in the org; this keeps it a tight index seek as the table grows.
--
-- CONCURRENTLY = no write lock on ActionTask while the index builds (it MUST run OUTSIDE a
-- transaction — run this file directly with psql, not inside a BEGIN/COMMIT).
-- Safe and reversible:
--   DROP INDEX CONCURRENTLY IF EXISTS "ActionTask_conversationId_actionType_createdAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ActionTask_conversationId_actionType_createdAt_idx"
  ON "ActionTask" ("conversationId", "actionType", "createdAt" DESC);
