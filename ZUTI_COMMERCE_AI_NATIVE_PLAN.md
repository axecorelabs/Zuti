# Zuti Commerce AI-Native Plan

## Goal
Build a dedicated commerce layer in this monorepo, powered by the existing API/auth stack, with an ecommerce specialist bot that:
- captures and routes orders reliably,
- answers product questions accurately,
- handles image-led product discovery ("do you have something like this?"),
- never fabricates product/price/stock/policy facts.

## Product Decisions (Confirmed)
- Payments: Zuti collects directly.
- Processor: Paystack first.
- Vendor settlement: subaccount per vendor.
- Inventory: multi-location support from day one.
- Catalog model: simple product + variant first.
- Bot strategy: support both generalist and specialist; launch ecommerce specialist first.

## Existing Foundations To Reuse
- Bot + capabilities + template framework in `apps/api/src/modules/bots`.
- Action-forwarding + intake contracts in `apps/api/src/modules/action-forwarding`.
- Operational-truth safeguards in `apps/api/src/common/utils/operational-integrity.ts`.
- Paystack billing primitives in `apps/api/src/modules/billing`.
- Existing `SalesOrder` action sink in Prisma schema.

## Specialist Bot Model
### New bot mode
Add bot mode for explicit specialization:
- `GENERALIST`
- `SPECIALIST`

For specialist bots, add `specialistSkill` and lock runtime behavior to one domain.

### Ecommerce specialist profile (first specialist)
`specialistSkill = SALES_ORDER`

Expected responsibilities:
- Product advisory/Q&A with grounded answers.
- Image-assisted product matching.
- Cart/order capture.
- Payment initialization and verification follow-up.
- Fulfillment routing by stock/location rules.

Out-of-scope requests:
- No cross-domain workflow execution (unless routed to human or another bot).

## AI-Native Commerce Requirements
### 1) Structured product context service
Create a product context resolver endpoint/service that returns only authoritative facts:
- product title, description, category,
- variant attributes (size, color),
- SKU,
- active price/currency,
- stock by location,
- media URLs,
- policy snippets (returns/shipping windows).

All bot commerce responses should source facts from this service.

### 2) Retrieval contract for responses
Before the bot answers a product claim, it must have evidence from product context.
If evidence is missing, the bot should:
- ask a clarifying question,
- or say it cannot confirm yet,
- never improvise.

### 3) Image-led discovery flow
When a user sends an image asking for similar items:
- Run vision extraction (style/category/color/material hints).
- Convert to product search query.
- Return top matches with confidence and explainable attributes.
- If no confident match, state that clearly and offer alternatives.

### 4) Conversion-oriented but truthful dialogue
The bot should:
- suggest closest in-stock alternatives,
- upsell compatible variants,
- ask one focused question at a time,
- avoid pressure language,
- avoid false urgency/availability claims.

## Commerce Domain (MVP data model)
Keep current `SalesOrder` for backward compatibility, but introduce commerce-native entities.

### New core entities
- `CommerceStore` (org-level or vendor-level merchant profile)
- `CommerceLocation` (multi-location inventory nodes)
- `CommerceProduct`
- `CommerceVariant`
- `CommerceInventoryLevel` (variant x location)
- `CommerceOrder`
- `CommerceOrderLine`
- `CommercePayment`
- `CommerceFulfillmentRoute`

### Essential fields
- `CommerceVariant`: `sku`, `attributes`, `priceMinor`, `currency`, `isActive`.
- `CommerceInventoryLevel`: `onHand`, `reserved`, `available`.
- `CommerceOrder`: `status`, `paymentStatus`, `allocationStatus`, `sourceChannel`, `conversationId`.
- `CommercePayment`: `provider=PAYSTACK`, `reference`, `subaccountCode`, `status`, idempotency fields.

## Status Machines
### Order status
`DRAFT -> PENDING_PAYMENT -> PAID -> ALLOCATED -> FULFILLMENT_PENDING -> FULFILLED`

Failure rails:
- `PAYMENT_FAILED`
- `ALLOCATION_FAILED`
- `MANUAL_REVIEW`

### Payment status
`INITIATED -> PENDING -> SUCCESS | FAILED | ABANDONED`

### Allocation status
`UNALLOCATED -> ALLOCATED | SPLIT_ALLOCATED | BACKORDER | MANUAL_REVIEW`

## Routing & Allocation Rules (Day One)
- Prefer nearest in-stock location.
- Fallback to next eligible location.
- If no stock: mark backorder/manual review.
- Record allocation evidence in order metadata.

## Paystack + Subaccount Design
- Store vendor-level Paystack subaccount metadata in commerce config.
- Initialize payment with proper split/subaccount routing.
- Verify every successful charge by webhook + server-side verification.
- Apply idempotent webhook handling.
- Never mark order `PAID` without verified success.

## Bot Contracts (Ecommerce Specialist)
### Required order intake fields
- customer_name
- customer_phone
- delivery_address
- product_sku OR normalized product + variant
- quantity
- payment_method

Optional:
- customer_email
- delivery_notes

### Deterministic missing-field prompts
Always ask only for missing fields, not repeated full forms.

### Truth contract
The bot cannot claim:
- order submitted,
- payment received,
- stock reserved,
- fulfillment dispatched,
unless corresponding system evidence exists.

## APIs To Add (MVP)
- `GET /commerce/products/search`
- `GET /commerce/products/:id`
- `GET /commerce/variants/:id/availability`
- `POST /commerce/orders` (draft/create)
- `POST /commerce/orders/:id/payment/initialize`
- `POST /commerce/payments/webhooks/paystack`
- `POST /commerce/orders/:id/allocate`
- `POST /commerce/orders/:id/route-fulfillment`

## Bot Runtime Integration
1. Detect ecommerce order or product inquiry intent.
2. Resolve product context before answering claims.
3. For image inquiry, run image->attributes->catalog match.
4. If user wants purchase, enter order intake state.
5. Create order draft and payment request.
6. Transition state only after verified events.

## Guardrails For "No Lying"
- Add response post-check that blocks unverified claims for stock, payment, delivery, and price certainty.
- Require references/evidence IDs in internal operational metadata.
- If evidence missing, rewrite reply to uncertainty-safe format.

## Suggested Implementation Sequence
### Sprint 1: Specialist framework + product truth layer
- Add specialist bot mode and specialist skill lock.
- Add commerce product context service.
- Add ecommerce specialist prompt/policy blocks.
- Add unverified-claim blocker for commerce-sensitive claims.

### Sprint 2: Order + payment + allocation
- Add commerce order entities and APIs.
- Integrate Paystack payment init + webhook verify for commerce orders.
- Add allocation/routing rules for multi-location.
- Add deterministic order follow-up messages.

### Sprint 3: Image-led matching + conversion tuning
- Add image similarity query flow.
- Add confidence thresholds and safe fallback behavior.
- Add alternative recommendations and upsell rules.
- Add specialist KPI dashboard.

## KPIs (Specialist Success)
- Product answer grounded rate.
- Image inquiry match success rate.
- Order intake completion rate.
- Payment conversion rate.
- Allocation success rate.
- Manual review rate.
- False-claim rate (target near zero).

## Compatibility Notes
- Keep existing `SalesOrder` and action-forwarding intact during migration.
- Run commerce order creation in parallel for a period (dual-write optional) before cutover.
- Preserve single auth/session model across Studio and Commerce dashboard.

## Next Concrete Build Step
Implement specialist bot mode + ecommerce specialist constraints in the existing bots and action-forwarding modules first, then layer commerce data APIs behind it.
