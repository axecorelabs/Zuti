# Action Forwarding + Internal Storage Implementation Plan

## Goal
Build a scalable system that:
- Detects actionable intents (meeting, order, owner alert, technical issue, etc.).
- Stores structured action data internally.
- Routes and sends external alerts to owners/team members via configured contact channels.
- Supports easy setup via bot templates with organization defaults and bot-specific overrides.

## Architecture Decisions
- Source of truth: Postgres (Supabase) with relational core + JSONB payloads.
- Throughput + reliability: Redis queues for async delivery, retries, dedupe, and rate limiting.
- Configuration hierarchy: org-level defaults + bot-level overrides.
- Data model: unified core tables + optional typed projection tables.

## Phase 0 - Foundations and Contracts
### Deliverables
- Intent/action contract and canonical action types.
- Routing policy contract.
- Delivery status contract.

### Action Types (initial)
- `MEETING_REQUEST`
- `SALES_ORDER_REQUEST`
- `OWNER_ATTENTION_NEEDED`
- `TECHNICAL_ISSUE`

### Exit Criteria
- Shared JSON schema for classifier output and routing input.
- Error contract for low confidence, missing fields, and no route configured.

## Phase 1 - Data Model + Config Layer
### Deliverables
- Bot template/capability fields.
- Contact endpoints for owner/team channels.
- Contact policies (org default and bot override).
- Action task and delivery tables.
- Optional typed projection tables for first domains.

### Tables
- `ContactEndpoint`
- `ContactPolicy`
- `ActionTask`
- `ActionDelivery`
- `Lead`
- `SalesOrder`
- `TechnicalIssue`

### Exit Criteria
- Prisma schema merged.
- Migration generated/applied.
- Indexes for common operational queries.

## Phase 2 - Routing Engine + Queue Orchestration
### Deliverables
- Routing resolver service (bot override -> org default -> fallback).
- Action forwarding queue setup.
- Idempotency key strategy and dedupe lock.
- Retry + dead-letter policy.

### Exit Criteria
- Deterministic route resolution with tests.
- Queue jobs process without blocking chat loop.

## Phase 3 - Classifier Integration + Extraction
### Deliverables
- LLM action classifier integration in inbound message pipeline.
- Extraction + validation of structured fields.
- Follow-up prompts for missing required fields.

### Exit Criteria
- Actions created only when confidence and policy thresholds are met.
- Missing required fields produce bot follow-up, not silent drops.

## Phase 4 - External Delivery Channels
### Deliverables
- Telegram delivery adapter.
- Email delivery adapter.
- Delivery receipt/ack handling.

### Exit Criteria
- End-to-end: inbound message -> action task -> routed alert -> delivery persisted.
- Retry behavior verified with transient failures.

## Phase 5 - Product Surface (Easy Setup)
### Deliverables
- Bot creation wizard step for template selection.
- Contact setup step (owner/team channels).
- Policy setup defaults by template.

### Exit Criteria
- New bot can be configured in <5 minutes.
- Validation blocks go-live if no contact routes are configured.

## Phase 6 - Scale, Cost, and Reliability
### Deliverables
- Data lifecycle policy (hot/warm/cold).
- Archival for old delivery payloads.
- Rate limiting and abuse controls.
- Metrics and alerting.

### Core Metrics
- Action detect rate.
- Route resolution failures.
- Delivery success rate.
- Mean acknowledge time.
- Retry/dead-letter volume.

### Exit Criteria
- No unbounded growth in hot storage.
- SLO dashboards for queue latency and delivery success.

## Immediate Implementation Order (this sprint)
1. Merge Phase 1 schema changes.
2. Add action forwarding queue constant and module wiring.
3. Add routing resolver service skeleton (org defaults + bot overrides).
4. Add queue processor scaffold.
5. Add classifier contract types for Phase 3 integration.

## Risks and Mitigations
- Risk: duplicate forwards from retries or duplicate webhook deliveries.
  - Mitigation: dedupe key + Redis lock + idempotent DB writes.
- Risk: no configured contact route.
  - Mitigation: fail-safe status `CONFIGURATION_NEEDED` + org notification.
- Risk: noisy low-confidence forwarding.
  - Mitigation: confidence threshold + optional confirmation policy.

## Current Status
- Plan created.
- Phase 1 implementation started in this branch.
