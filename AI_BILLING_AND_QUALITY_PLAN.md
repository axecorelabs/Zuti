# AI Quality + Invoice-Accurate Billing Plan

## 1) Goals

### Primary outcomes
- Improve response quality using model orchestration (Haiku + DeepSeek + Gemini) without uncontrolled cost growth.
- Stop heuristic token estimation for billing.
- Bill and deduct credits using actual provider usage and pricing (invoice-aligned).
- Maintain auditable, reproducible cost and credit ledgers per organization.

### Non-goals (initial phase)
- Real-time pass-through pricing per tenant with custom contracts.
- Retroactive rebilling of historical conversations.
- Multi-currency invoicing redesign.

## 2) Current Issues to Fix

- Billing relies on heuristic token estimation (`JSON length / 4`) in multiple modules.
- Some AI paths are metered but not debited; some are not metered at all.
- Multiple model calls in a single logical reply are not billed as separate provider events.
- Provider labels in usage events are inconsistent with actual upstream provider path.
- Pricing estimates do not fully include all debited AI usage types.

## 3) Target Architecture

## 3.1 Execution Orchestration (quality)

### Model roles
- `Claude Haiku`: router + quality critic.
- `DeepSeek`: reasoning/draft generation for medium/high-complexity turns.
- `Gemini`: final user-facing response writer.

### Pipeline
1. Router pass (Haiku): classify complexity/risk and choose route.
2. Draft pass (DeepSeek): only for routed complex turns.
3. Final pass (Gemini): produce customer response.
4. Critic pass (Haiku): validate grounding/compliance/operational integrity.
5. Retry once if critic fails; else escalate to human.

### Routing policy
- Low complexity: Gemini only.
- Medium/high complexity: DeepSeek -> Gemini -> Haiku critic.
- High-risk intents (billing/orders/account actions): mandatory critic.

## 3.2 Billing Source of Truth (cost)

### Billing principle
- Every provider call generates one immutable usage event with provider-reported usage and pricing snapshot.
- Credit deduction is computed from that event, not from heuristic estimates.

### Core rule
- No AI completion/transcription/embedding call should be considered billable unless a `ProviderUsageEvent` exists.

## 4) Data Model Changes

## 4.1 New tables/entities

### `ProviderUsageEvent` (new)
- `id`
- `organizationId`
- `conversationId` (nullable)
- `logicalOperationId` (groups multiple provider calls within one user turn)
- `routeStep` (`ROUTER`, `DRAFT`, `FINAL`, `CRITIC`, `SUMMARIZE`, `MEDIA_TRANSCRIBE`, `MEDIA_VISION`, `EMBED`, etc.)
- `provider` (openrouter/openai/anthropic/google/groq/jina/etc.)
- `model`
- `apiProduct` (chat, responses, embeddings, audio_transcription, vision)
- `requestId` (provider-side request id if available)
- `promptTokens`
- `completionTokens`
- `cachedPromptTokens` (nullable)
- `totalTokens`
- `inputUnits`/`outputUnits` (for non-token APIs if needed)
- `unitPriceInputMicros`
- `unitPriceOutputMicros`
- `currency`
- `rawCostMinor` (cost in minor units from exact formula)
- `pricingVersion`
- `metadata` (raw usage blob, latency, endpoint)
- `idempotencyKey` (unique)
- `createdAt`

### `CreditDebitAllocation` (new)
- `id`
- `organizationId`
- `providerUsageEventId`
- `creditLedgerId`
- `creditsDebitedUnits`
- `conversionVersion`
- `createdAt`

Purpose: explicit mapping from provider cost event -> credit debit ledger entry.

## 4.2 Existing table updates

### `AiUsageEvent`
- Keep for analytics/feature grouping, but no longer primary billing source.
- Add optional linkage: `providerUsageEventId` (nullable for legacy).

### `CreditLedger`
- Continue as wallet ledger, but add enforced metadata keys for AI debits:
  - `providerUsageEventId`
  - `rawCostMinor`
  - `creditConversionRate`
  - `conversionVersion`

## 4.3 Constraints
- Unique idempotency for provider event ingest (`idempotencyKey`).
- Unique mapping one `ProviderUsageEvent` -> at most one `CreditDebitAllocation`.
- Transactional write of allocation + credit ledger debit.

## 5) Provider Usage Capture

## 5.1 AI service contract updates

### Chat endpoints
- Return structured usage payload from each provider call:
  - provider, model, endpoint
  - token usage fields from provider response
  - request id
  - raw usage JSON

### Multi-step orchestration
- Return array of step usage records:
  - one record per step (`ROUTER`, `DRAFT`, `FINAL`, `CRITIC`)

### Media endpoints
- Return billable units (or usage details) for transcription/vision calls.

### Embeddings
- Return token count/units where provider supports it; include fallback unit metric when token data unavailable.

## 5.2 API service ingestion
- Replace estimated token generation with `ProviderUsageEvent` writes using returned usage payload.
- Compute raw provider cost with a versioned pricing table in backend config/DB.
- Deduct credits from wallet based on raw cost conversion policy.

## 6) Pricing and Credit Conversion

## 6.1 Separate layers
- `Provider cost`: objective monetary cost from provider usage x provider rates.
- `Customer credits`: business-facing abstraction derived from provider cost via conversion policy.

## 6.2 Conversion policy (versioned)
- `creditPerMinorUnit` or `minorUnitPerCredit` by market/plan.
- Optional markup floor by usage type.
- Optional minimum debit per operation.
- Store `conversionVersion` on every debit.

## 6.3 Invoice alignment
- Daily reconciliation job:
  - Sum `rawCostMinor` by provider/model/day.
  - Compare to provider dashboard export/API totals.
  - Alert on drift > threshold (e.g., 1-2%).

## 7) Rollout Plan

## Phase 0: Foundations (1 sprint)
- Add schema and migrations for `ProviderUsageEvent` + `CreditDebitAllocation`.
- Add pricing version table/config.
- Add ingestion service with idempotency and validation.

### Exit criteria
- Can store provider usage events from mocked payloads.
- Can compute raw provider cost deterministically.

## Phase 1: Dual-write (1 sprint)
- Keep current heuristic flow active.
- Also ingest provider usage payload and compute invoice-accurate cost in shadow mode.
- Do not change user-facing deductions yet.

### Exit criteria
- Drift dashboard shows heuristic vs actual per org/day.
- No data loss under retries/timeouts.

## Phase 2: Switch debits to actual usage (1 sprint)
- Debit wallet credits from provider-actual events.
- Keep heuristic calculations only for observability comparison.
- Introduce safety caps and graceful fallback behavior.

### Exit criteria
- 100% AI debit entries tied to `ProviderUsageEvent`.
- No unresolved debit failures in production logs.

## Phase 3: Orchestration quality rollout (1-2 sprints)
- Enable Haiku router first.
- Enable DeepSeek draft for selected complexity thresholds.
- Enable Haiku critic on high-risk turns.
- Expand gradually with feature flags and per-org rollout.

### Exit criteria
- Improved CSAT/reopen metrics at controlled cost per resolution.

## 8) Fallback and Failure Handling

- If provider usage payload is missing:
  - Mark event as `UNBILLABLE_PENDING_RECON` and queue reconciliation.
  - Do not silently revert to heuristic charging in production path.
- If debit transaction fails after usage recorded:
  - place in retry queue with idempotent debit key.
- If wallet insufficient:
  - honor policy (block, degrade to cheaper path, or allow limited overdraft by plan).

## 9) Observability and Controls

### Dashboards
- Cost per resolved conversation.
- Average provider cost per route path (low/med/high complexity).
- Credit margin by org and plan.
- Debit failures, reconciliation drift, missing usage payload count.

### Alerts
- Drift > threshold.
- Spike in multi-step route usage.
- Missing provider request ids.
- Duplicate idempotency collisions beyond baseline.

## 10) API/Contract Changes

- AI service response schema: include `usageEvents[]`.
- API service internal contract: `recordProviderUsageAndDebit(logicalOperation)`.
- Preserve existing external endpoint shape for clients; perform billing changes server-side.

## 11) Testing Strategy

### Unit tests
- Cost computation by provider/model/rate version.
- Credit conversion policy.
- Idempotency behavior.

### Integration tests
- End-to-end: chat request -> multiple provider steps -> provider events -> credit ledger debit.
- Retry scenarios and partial failures.

### Reconciliation tests
- Seed synthetic provider reports; validate drift detection and corrective actions.

## 12) Security and Compliance

- Do not persist raw prompts in billing tables unless required.
- Store only required metadata and hashed identifiers where possible.
- Ensure secrets never appear in usage metadata.
- Access control for billing and cost visibility endpoints.

## 13) Backfill and Migration

- No retroactive rebilling of legacy events.
- Optional: backfill `AiUsageEvent.providerUsageEventId` where deterministic mapping exists.
- Mark pre-cutover events with `billingMethod = HEURISTIC_LEGACY` in reporting layer.

## 14) Product/Pricing Communication

- Update docs: credits are now based on actual provider usage, converted by plan policy.
- Explain that complex “high-accuracy mode” may consume more credits.
- Add per-conversation cost breakdown in admin UI (optional but recommended).

## 15) Concrete Implementation Checklist

## 15.1 Schema and backend
- [ ] Add Prisma models for `ProviderUsageEvent` and `CreditDebitAllocation`.
- [ ] Add migration + indexes + unique constraints.
- [ ] Implement `ProviderUsageService` in API.
- [ ] Implement `CostComputationService` with provider/model rate tables.
- [ ] Implement `CreditConversionService` with versioned conversion policy.
- [ ] Add atomic debit allocator (`ProviderUsageEvent` -> `CreditLedger`).

## 15.2 AI service
- [ ] Add usage extraction for OpenRouter chat responses.
- [ ] Add usage extraction for Whisper/transcription endpoint.
- [ ] Add usage extraction for Jina embeddings.
- [ ] Return `usageEvents[]` from chat/summarize/media/commerce/classifier endpoints.

## 15.3 Feature paths
- [ ] Migrate `CUSTOMER_REPLY` billing to actual usage.
- [ ] Migrate `SUMMARIZATION` billing to actual usage.
- [ ] Migrate `MEDIA_TRANSCRIPTION` and `MEDIA_VISION` billing to actual usage.
- [ ] Decide billability for `CSAT_CLASSIFICATION`, `LANGUAGE_CLASSIFICATION`, `ACTION_INTENT`, `COMMERCE_DESCRIPTION`, `EMBEDDINGS`.

## 15.4 Quality orchestration
- [ ] Add route decision object and thresholds.
- [ ] Add DeepSeek draft step.
- [ ] Add Haiku critic step.
- [ ] Add one-retry policy and escalation fallback.

## 15.5 Ops and launch
- [ ] Add reconciliation cron job and drift alerts.
- [ ] Add dashboards for cost/margin/quality.
- [ ] Run dual-write for at least 1-2 weeks.
- [ ] Execute phased cutover by org cohort.

## 16) Decision Log (to finalize before build)

- Should classifier calls be billable or absorbed overhead?
- Should embedding costs be billed immediately or amortized per retrieval usage?
- What is the minimum debit floor per operation?
- What margin target per plan do we enforce?
- What fallback policy applies when cost capture is missing?

## 17) Recommended First Milestone (next 7 days)

1. Implement schema + provider usage ingestion endpoint.
2. Update AI service chat endpoint to return structured usage for each orchestration step.
3. Dual-write provider usage events from one high-volume path (e.g., WhatsApp replies).
4. Build drift report comparing heuristic charges vs actual provider cost.
5. Review data and set cutover date for actual-usage debit in that single path.

## 18) User-Selectable Quality Modes and Pricing Model

## 18.1 Product objective
- Let each organization choose reply quality mode based on business priority:
  - lower cost and faster responses
  - higher quality and reasoning depth
- Keep billing transparent: users should know high-quality mode spends more credits.

## 18.2 Proposed quality modes

### Mode A: Economy
- Default model path: Gemini-only for most turns.
- Optional safety critic only on high-risk intents.
- Target: minimum credits per reply and lowest latency.

### Mode B: Balanced
- Router enabled (Haiku).
- Gemini-only for low complexity, DeepSeek draft for medium/high complexity.
- Critic enabled only when risk threshold is exceeded.
- Target: better answer quality with moderate credit uplift.

### Mode C: Premium
- Router always enabled.
- DeepSeek draft + Gemini final for all but trivial turns.
- Critic always enabled for business-critical intents.
- Target: maximum quality and consistency with higher credit spend.

## 18.3 Billing behavior by mode

### Core principle
- Bill from actual provider usage events, then apply mode-aware conversion policy.

### Debit policy options
1. Pure pass-through:
- Credits map directly to provider cost, independent of mode.
- Pros: simplest and fairest; Cons: less predictable to users.

2. Mode multipliers (recommended):
- Compute actual cost first, then apply mode multiplier to converted credits.
- Example multipliers (initial):
  - Economy: 1.00x
  - Balanced: 1.15x
  - Premium: 1.30x
- Pros: clear positioning; predictable margin.

3. Included allowance by mode:
- Monthly included credits differ by mode, overage at same conversion rate.
- Pros: packaging flexibility for plans.

### Recommendation
- Start with option 2 (mode multipliers) plus a per-operation minimum floor.

## 18.4 Configuration model

### New settings
- Organization-level default quality mode.
- Optional channel-level override (email/whatsapp/telegram/widget).
- Optional bot-level override.

### Suggested precedence
1. Per-request override (if allowed by plan)
2. Bot override
3. Channel override
4. Organization default

## 18.5 Customer experience requirements

- Settings UI should show:
  - Current mode
  - Last 7-day average credits per resolved conversation
  - Estimated monthly credits at current volume
  - "What changes" summary before switching mode
- Add warning when switching to Premium: "Higher quality, higher credit usage."
- Add optional auto-downgrade safeguard when wallet is low.

## 18.6 Safeguards and abuse prevention

- Cooldown on frequent mode changes (e.g., max 1 change per hour).
- Optional policy: Premium unavailable on low-credit wallet unless owner confirms.
- Hard cap on critic retries (max one retry).
- Emergency fallback path to Economy when provider outages occur.

## 18.7 Metrics and experimentation

### Track per mode
- CSAT
- Reopen rate
- Escalation rate
- Cost per resolved conversation
- Credits per reply
- p95 latency

### Experiment plan
1. Internal dogfood with 3 modes.
2. 10% cohort test for Balanced default.
3. Expand by segments after margin + quality validation.

## 18.8 Implementation tasks

### Schema/API
- [ ] Add `qualityMode` to organization settings (and optional bot/channel override tables).
- [ ] Add `qualityMode` to `ProviderUsageEvent` and debit metadata.
- [ ] Add mode multiplier/version table.

### Runtime
- [ ] Add router logic that respects selected mode.
- [ ] Add mode-aware route planner (which steps run in each mode).
- [ ] Add mode-aware credit conversion in debit pipeline.

### Frontend/Admin
- [ ] Add settings controls for mode selection.
- [ ] Add usage/cost impact preview card.
- [ ] Add mode change audit log.

## 18.9 Go-live criteria for mode-based pricing

- Invoice drift <= 2% for 14 consecutive days.
- No unresolved debit failures for mode-tagged events.
- Premium mode shows statistically significant quality improvement vs Economy.
- Margin by mode remains above target floor.

## 19) Additional Decisions to Finalize

- Which mode is default for new organizations?
- Should users be charged instantly for mode switches (no), or only by actual usage (yes)?
- Should Premium include SLA-like guarantees or remain best-effort?
- Do we expose per-turn model path details to customers or only credit totals?
