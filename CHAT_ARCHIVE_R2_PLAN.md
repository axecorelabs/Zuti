# Chat Archival to R2 Plan (Deferred Implementation)

## Status
- Decision: Approved as future work.
- Implementation timing: Not now.
- Target behavior: Archive old resolved conversations to R2 after 3 days while preserving accountability and operational UX.

## Goals
- Reduce primary DB storage growth from cold chat history.
- Preserve complete auditability and retrieval for support/legal use.
- Keep active support workflows fast (inbox, routing, escalations, CSAT, analytics).

## Non-Goals
- Replacing Postgres with object storage for live operations.
- Changing current assignment, escalation, or CSAT semantics.
- Introducing user-visible archival behavior changes in this phase.

## High-Level Architecture
- Hot path (Postgres): active and recently-resolved conversations/messages.
- Cold path (R2): full transcript blobs for conversations resolved for >= 3 days.
- Pointer model (Postgres): keep minimal metadata + archive pointer + integrity hash.

Flow:
1. Conversation becomes resolved.
2. Scheduled archival job identifies eligible records (resolved >= 72h, not awaiting CSAT).
3. Job writes transcript blob to R2 (immutable key).
4. Job stores archive metadata in Postgres and optionally prunes old message rows.
5. Read path checks DB first; if archived, loads transcript from R2 seamlessly.

## Data Model Changes (Planned)
- `Conversation` additions:
  - `archivedAt` (timestamp, nullable)
  - `archiveProvider` (enum/string, e.g. `R2`)
  - `archiveKey` (string, nullable)
  - `archiveChecksum` (string, nullable)
  - `archivedMessageCount` (int, nullable)
  - `archiveVersion` (int, default 1)
- Optional archive table (`ConversationArchive`) if you prefer normalized metadata and lifecycle history.
- Keep existing accountability fields and activity logs in DB.

## What Stays in Postgres (Accountability Layer)
- Conversation identity and ownership:
  - ids, org id, channel, customer identifiers
- Workflow/audit state:
  - status transitions, assignment, escalation links, CSAT outcome
- Timeline metadata:
  - createdAt, resolvedAt, lastMessageAt, archivedAt
- Integrity and retrieval metadata:
  - archiveKey, archiveChecksum, messageCount

## What Moves to R2
- Full message transcript payload (JSONL or compressed JSON), including:
  - message id, role, content, createdAt, metadata
- Optional related artifacts (if any) under same conversation prefix.

Recommended object key:
- `org/{orgId}/conversation/{conversationId}/v{archiveVersion}.json.gz`

## Integrity and Immutability
- Compute SHA-256 checksum of archived payload and persist in DB.
- Treat archived objects as immutable (new version key on any re-archive).
- Add periodic integrity verification task (sampled or full).

## Eligibility Rules
A conversation is eligible only if all are true:
- `status = RESOLVED`
- `resolvedAt <= now - 72h` (or fallback to `updatedAt` if needed)
- `metadata.awaitingCsat != true`
- Not already archived (or marked archive-invalid)

## Archival Job Design
- Scheduler: hourly or every 6 hours.
- Batch size: start 100-500 conversations/job run.
- Idempotency:
  - skip when `archiveKey` already set and checksum present
  - lock by conversation id while processing
- Failure handling:
  - retry with exponential backoff
  - dead-letter/report after N failures

## Pruning Strategy
- Phase 1 (safer): archive only, do not delete DB messages.
- Phase 2: prune message rows after successful archive + checksum persisted.
- Phase 2 guardrails:
  - soft-delete marker first
  - delayed hard delete window (e.g., +7 days)

## Read Path Behavior
- Existing APIs continue returning conversation metadata from DB.
- For archived conversations, message-fetch endpoint:
  - returns DB messages if present
  - otherwise streams/reads transcript from R2 via archiveKey
- UI should remain transparent (optional "Archived" badge for admins).

## Security and Compliance
- Encrypt in transit and at rest.
- Restrict bucket access to service principals only.
- Consider per-org key prefixes and IAM policy scoping.
- Add retention/deletion policy by plan/compliance requirements.

## Observability
Track and alert on:
- Archival success/failure rate
- Average archive latency per conversation
- R2 write/read errors
- DB storage growth trend
- API p95/p99 for inbox/message endpoints before vs after

## Rollout Plan
1. Feature flags
- `ARCHIVE_ENABLED=false`
- `ARCHIVE_PRUNE_ENABLED=false`

2. Phase A (dry run)
- Identify candidates and log counts only.

3. Phase B (write-only)
- Archive to R2, keep DB messages intact.

4. Phase C (read fallback)
- Enable R2 read path for archived conversations.

5. Phase D (controlled prune)
- Enable pruning for a subset of orgs.

6. Phase E (general availability)
- Expand to all orgs with guardrails and monitoring.

## Rollback Plan
- Disable feature flags immediately.
- Continue serving from DB.
- If pruning enabled, restore from R2 using archive objects and checksums.

## Open Questions
- Do we need cross-region R2 replication for DR?
- Should archive retention differ by pricing tier?
- Should archived transcripts be searchable, and if yes, where indexed?

## Success Criteria
- >= 30-60% reduction in message-table growth over 30-60 days.
- No degradation in inbox/escalation response latency.
- 100% checksum-valid archive retrieval for sampled audits.
- Zero workflow regressions in assignment, CSAT, and escalation paths.
