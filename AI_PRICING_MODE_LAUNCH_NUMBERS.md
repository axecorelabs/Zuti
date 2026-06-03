# AI Pricing Mode Launch Numbers (Draft v1)

## 1) Purpose

This document defines initial launch numbers for selectable AI quality modes:
- Economy
- Balanced
- Premium

It is designed to pair with `AI_BILLING_AND_QUALITY_PLAN.md` and assumes billing is computed from actual provider usage events, then converted to credits.

## 2) Principles

- Provider-invoice alignment first, business packaging second.
- Keep customer pricing predictable.
- Protect margin with mode multipliers and minimum debit floors.
- Prevent wallet shock through safeguards and automatic degradation rules.

## 3) Base Conversion (Global)

## 3.1 Reference conversion
- `conversionVersion`: `2026-06-v1`
- `1 credit = 100 credit units`
- Base debit derived from actual provider cost event (`rawCostMinor`) using per-market conversion policy.

## 3.2 Market policy (initial)
- NG market:
  - `minorUnitPerCredit`: 1000 (NGN 10.00 per credit equivalent)
- US market:
  - `minorUnitPerCredit`: 100 (USD 1.00 per credit equivalent)

Note: These are launch placeholders for modeling and should be validated against actual provider blended cost and target gross margin.

## 4) Mode Multipliers (Launch)

Applied after converting raw provider cost into base credits.

- Economy: `1.00x`
- Balanced: `1.15x`
- Premium: `1.30x`

Formula:
- `creditsDebited = ceil(baseCreditsFromProviderCost * modeMultiplier, 0.01)`

Rounding policy:
- Round up to nearest 0.01 credits (or nearest credit unit).

## 5) Minimum Debit Floors

These floors avoid near-zero debits for tiny calls and improve predictability.

## 5.1 Per operation floor by mode
- Economy:
  - Customer reply: `0.40` credits
  - Summarization: `0.70` credits
  - Classifier/utility call: `0.05` credits (if billable)
- Balanced:
  - Customer reply: `0.50` credits
  - Summarization: `0.80` credits
  - Classifier/utility call: `0.06` credits
- Premium:
  - Customer reply: `0.60` credits
  - Summarization: `0.95` credits
  - Classifier/utility call: `0.08` credits

## 5.2 Floor application rule
- Final debit per logical operation = `max(calculatedCredits, operationFloor)`.

## 6) Suggested Billability Policy by Usage Type

## 6.1 Bill immediately
- `CUSTOMER_REPLY`
- `SUMMARIZATION`
- `MEDIA_TRANSCRIPTION`
- `MEDIA_VISION`

## 6.2 Bill in phase 2 (after user communication)
- `ACTION_INTENT`
- `LANGUAGE_CLASSIFICATION`
- `CSAT_CLASSIFICATION`
- `COMMERCE_DESCRIPTION`

## 6.3 Product decision needed
- `EMBEDDINGS`:
  - Option A: bill at ingest time (simple)
  - Option B: amortize over retrieval volume (fairer but more complex)

Launch recommendation: Option A for first release.

## 7) Low-Wallet Safeguards

## 7.1 Soft threshold
- Trigger when wallet < estimated 2 days of current burn.
- Show warning banner and mode recommendation.

## 7.2 Hard thresholds by mode
- Premium:
  - If wallet < `15 credits`, auto-fallback to Balanced unless owner re-confirms.
- Balanced:
  - If wallet < `8 credits`, auto-fallback to Economy unless owner re-confirms.
- Economy:
  - If wallet < `2 credits`, allow only essential responses (or block per policy).

## 7.3 Auto-downgrade behavior
- Downgrade applies at org-level default mode.
- Log audit event with previous mode, new mode, threshold, actor `SYSTEM`.
- Notify OWNER/ADMIN once per 24h to avoid alert spam.

## 8) Margin Targets by Mode

- Economy:
  - Target gross margin: `>= 35%`
  - Alert if trailing 7-day margin < `30%`
- Balanced:
  - Target gross margin: `>= 45%`
  - Alert if trailing 7-day margin < `40%`
- Premium:
  - Target gross margin: `>= 55%`
  - Alert if trailing 7-day margin < `50%`

Operational formula:
- `modeMargin = (creditsValueDebited - providerCostValue) / creditsValueDebited`

## 9) Complexity Routing Thresholds (Initial)

Used to control how often expensive multi-step path runs.

- Complexity score range: `0.0 - 1.0`
- Risk score range: `0.0 - 1.0`

## 9.1 Economy
- Multi-step only if:
  - `risk >= 0.80` OR high-risk intent list match.
- Expected multi-step rate: `<= 8%`.

## 9.2 Balanced
- Multi-step if:
  - `complexity >= 0.55` OR `risk >= 0.65`.
- Expected multi-step rate: `10% - 25%`.

## 9.3 Premium
- Multi-step if:
  - `complexity >= 0.35` OR `risk >= 0.50`.
- Expected multi-step rate: `30% - 60%`.

## 10) Pilot Cohorts and Dates

Reference start date: `2026-06-10`.

## Cohort 0: Internal
- Window: `2026-06-10` to `2026-06-16`
- Audience: internal orgs only
- Goal: validate debit correctness and UX clarity

## Cohort 1: Early design partners (10%)
- Window: `2026-06-17` to `2026-06-30`
- Audience: opt-in SMB tenants
- Goal: compare Economy vs Balanced outcomes

## Cohort 2: Controlled expansion (30%)
- Window: `2026-07-01` to `2026-07-14`
- Audience: mixed channel tenants
- Goal: verify margins and latency at scale

## Cohort 3: General availability
- Target date: `2026-07-15`
- Preconditions:
  - invoice drift <= 2% for 14 consecutive days
  - debit failure rate < 0.2%
  - Premium quality gains statistically significant

## 11) Experiment Matrix

## 11.1 A/B/C groups
- Group A: Economy default
- Group B: Balanced default
- Group C: Premium default (small subset)

## 11.2 Decision metrics
- Quality:
  - CSAT
  - reopen rate
  - escalation precision
- Cost:
  - credits per resolved conversation
  - provider cost per resolved conversation
  - margin by mode
- Performance:
  - p95 first response latency

## 11.3 Guardrail limits
- If p95 latency increases > 35%, pause Premium expansion.
- If 7-day margin drops below floor in any mode, adjust multiplier before expanding cohort.

## 12) Communication Copy (Launch)

## Economy
- "Fast and cost-efficient responses using a simpler model path."

## Balanced
- "Improved reasoning for harder questions with moderate credit usage."

## Premium
- "Highest response quality with deeper multi-model reasoning and higher credit usage."

## 13) Engineering Checklist for This Numbers Pack

- [ ] Add `qualityMode` enum and settings storage.
- [ ] Add mode multipliers to conversion policy table (`conversionVersion` scoped).
- [ ] Implement operation debit floors by usage type and mode.
- [ ] Implement low-wallet auto-downgrade worker.
- [ ] Add admin dashboard cards: margin by mode, credits per resolution, drift.
- [ ] Add experiment flags and cohort assignment logic.

## 14) Revision Procedure

- Review these numbers weekly for first 6 weeks post-launch.
- Update only via new `conversionVersion` (no in-place mutation).
- Keep changelog:
  - old multiplier/floor
  - new multiplier/floor
  - reason
  - expected margin impact
