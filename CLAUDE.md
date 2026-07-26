# CLAUDE.md — working guide for this repo

Zuti is a multi-tenant AI customer-support + commerce/events platform.
Monorepo: `apps/api` (NestJS, :3001), `apps/ai-service` (Python FastAPI, :8000, via OpenRouter),
`apps/web` (Next.js 14, :3000), `packages/database` (Prisma + Supabase). Payments via Paystack.
The prod and dev databases are the **same shared Supabase instance**. VPS deploy runs
`prisma generate` only — **not** `migrate deploy`; schema changes are applied to the shared DB
manually (SQL saved under `packages/database/prisma/manual/`) before/alongside the schema change.

## Compliance-by-default (read `COMPLIANCE.md`)

We build **in line with data-protection law** — GDPR baseline, and by extension UK GDPR, NDPA
(Nigeria), CCPA/CPRA, and the state/international patchwork. Compliance is a design input, not a
later pass. See [`COMPLIANCE.md`](./COMPLIANCE.md) for the full posture. The non-negotiables when a
feature touches **customer/personal data** or **communications**:

- **Roles:** organizations are the data **controllers**; Zuti is the **processor**. We build the
  *tooling* for compliance; we don't obtain end-customer consent ourselves.
- **Minimize & limit purpose:** store people with a real relationship (registered / purchased /
  booked), not "everyone who ever messaged." Don't repurpose transactional data for marketing.
- **Transactional vs marketing:** tag every outbound message. Transactional (ticket, receipt, order
  update) is fine to send; **marketing requires opt-in (EU) / opt-out (US)** and must honor a
  per-person, per-channel **suppression flag** + include an **unsubscribe** link.
- **Ship the primitives with the first commit:** consent/suppression flag, unsubscribe, per-person
  **export**, per-person **delete/erasure**, rectification, and a "we don't sell data" stance.
- **Sub-processors & AI:** any personal data sent to Supabase / ZeptoMail / Paystack / **the LLM**
  must be disclosed as a sub-processor; keep **LLM terms no-train / zero-retention**; mind
  cross-border transfer when EU data is involved.

If a requested feature would cut a corner here, surface it rather than silently shipping it.

## Conventions

- Match surrounding code style; keep changes minimal and in-idiom.
- Multi-tenant: **everything is scoped by `orgId`** — never write a query or endpoint that can leak
  across tenants.
- Pricing/amounts are **backend-authoritative** — never trust client-supplied prices; charge from the
  catalog / ticket tier.
- Money is stored in **minor units** (`*Minor` integer fields).
- Verify changes against the running stack before claiming done (API :3001, AI :8000, web :3000).
