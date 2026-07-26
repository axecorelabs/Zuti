# Customer Hub — Stage 1 Design Note

> Status: **draft for review**. Intended as the first commit on `feature/customer-hub`.
> Build **compliant-by-default** (see `COMPLIANCE.md`) and within the product-direction guardrail
> (see `CLAUDE.md`): the hub is a people/CRM spine + contextual intelligence, **not** a BI product.

## 1. Purpose & scope

Zuti currently stores customer identity fragments in ≥6 places (`Conversation`, `Lead`, `Booking`,
`SalesOrder`, `CommerceOrder`, `RegistrationEntry`) with nothing linking them. This creates a
first-class **`Customer`** — one record per real person per org — that those fragments attach to, so a
business has a single, unified view of, and source of truth for, each person they serve. It also
becomes the substrate all of an org's AI agents read from and enrich.

**Stage 1 (this note):** the entity + identity/merge + backfill + Customers list + Customer profile +
AI read/write + compliance primitives. **Not** in Stage 1: segmentation rules, custom attributes,
broadcast/comms, smart cross-channel matching. (See §12.)

## 2. Core concept

- **`Customer` = a person the business has had a real, first-party interaction with**, moored to the
  channel(s) they control. "Customer" is a **loose umbrella** term.
- **`lifecycleStage`** carries the precision: `lead → engaged → customer` (advances as they give a
  name / transact). A one-message contact IS created — as a `lead`. The default Customers view shows
  `engaged`/`customer`; `lead` is filterable — so raw pings don't clutter the main list.

## 3. Identity model (the load-bearing part)

Identity lives on **identifiers**, not on the person record.

- **Anchor** = an identifier the person *demonstrably controls* — a channel of contact:
  Telegram `chatId` they messaged from, WhatsApp number they messaged from, an email they emailed
  *from*. Anchors are the ONLY things allowed to auto-attach an interaction or auto-merge two records.
- **Attribute** = data they *typed* (checkout email/phone, a name). Stored as contact data; may
  *suggest* a link for human confirmation; **never** drives an automatic merge. (Multi-attendee ticket
  emails are attributes — which is why attendees don't become Customers.)
- `isAnchor` is a property of *how the identifier was captured*, not of the value: `ada@x.com` is an
  anchor if Ada emailed from it, an attribute if someone typed it at checkout.

**Resolution algorithm** (on any inbound event carrying identifiers):
1. Normalize (lowercase email, E.164 phone).
2. Look up each **anchor** identifier in `CustomerIdentifier`.
   - One match → that Customer.
   - Matches across *different* Customers → they share a strong signal → **merge** (the only auto-merge path).
   - No match → **create** a new Customer with those identifiers.
3. Attribute identifiers → attach as `isAnchor=false`; used only for *suggested*, human-confirmed links.

**Bias: under-merge, never over-merge.** Over-merging leaks one person's data into another's (a trust
& compliance breach); under-merging is a mild duplicate. So cross-channel duplicates (Telegram-person
vs email-person) are *expected* and OK until a shared anchor or a **manual merge** bridges them.

**Merge op:** pick a survivor, repoint identifiers + conversations + transactions, union attributes,
log the merge (reversible if feasible).

## 4. Creation rule (birth events)

A Customer is born exactly two ways, both anchor-producing:
1. Someone **contacts** the business on a channel they control (Telegram/WhatsApp/email/widget) →
   anchored on that channel-of-contact.
2. Someone **transacts** in a way that yields an owned channel (public web purchase → receipt email)
   → anchored on that email, flagged **lower-confidence**.

Consequence: minimization + lawful basis are satisfied *by construction* — a Customer only exists
because they reached out (service relationship) or transacted (contract). Never scraped, never
inferred, never for a third party whose data was merely typed in.

## 5. Data model (schema sketch — refine at implementation)

```prisma
model Customer {
  id            String   @id @default(cuid())
  orgId         String
  displayName   String?
  primaryEmail  String?          // best-known; not authoritative identity
  primaryPhone  String?
  lifecycleStage CustomerLifecycle @default(LEAD)
  // consent / compliance
  emailOptOut   Boolean  @default(false)
  marketingConsentAt DateTime?    // opt-in timestamp (null = no marketing consent)
  firstSeenAt   DateTime @default(now())
  lastSeenAt    DateTime @default(now())
  // relations
  identifiers   CustomerIdentifier[]
  // (progressive) back-links added as we touch each module:
  // conversations, salesOrders, registrationEntries, bookings, commerceOrders, leads
  @@index([orgId, lifecycleStage])
  @@index([orgId, primaryEmail])
}

model CustomerIdentifier {
  id         String   @id @default(cuid())
  customerId String
  orgId      String
  type       IdentifierType   // TELEGRAM_CHAT | WHATSAPP_PHONE | EMAIL | PHONE | WIDGET_SESSION
  value      String           // normalized
  isAnchor   Boolean          // channel-of-contact (true) vs typed attribute (false)
  verifiedAt DateTime?
  source     String?          // where captured (bot id, order id, …)
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  @@unique([orgId, type, value])   // an identifier maps to exactly one Customer per org
  @@index([customerId])
}

enum CustomerLifecycle { LEAD ENGAGED CUSTOMER }
enum IdentifierType { TELEGRAM_CHAT WHATSAPP_PHONE EMAIL PHONE WIDGET_SESSION }
```

Existing tables gain a nullable `customerId` **progressively** (as each is touched), not all at once.

## 6. Linking & backfill

- **Backfill (one-time):** walk existing `Conversation`, `SalesOrder`, `RegistrationEntry`, `Booking`,
  `CommerceOrder`, `Lead`; for each, derive anchor/attribute identifiers, run the resolution algorithm,
  create/attach Customers. Idempotent + rerunnable. Applied via the manual-migration flow
  (`packages/database/prisma/manual/`) since the VPS deploy runs `prisma generate` only.
- **Going forward:** each entry point (webhook ingest, order create, registration, booking) resolves/
  creates a Customer and sets `customerId`.

## 7. AI access — read (context) + write (enrichment)

- **Scope:** Customer is `orgId`-scoped; **all of an org's agents share it**; **never** cross-tenant.
- **Read:** at conversation start, load a *need-to-know* slice of the profile into agent context
  (identity, lifecycle, recent orders/tickets, key notes) — contextual intelligence in the chat, not a
  dashboard. Minimize what's sent (compliance: richer PII → keep LLM input lean).
- **Write (field discipline):**
  - **Protected** (identity anchors, verified email/phone, consent/opt-out): AI may *suggest*, never
    *overwrite*; AI can **never set an anchor or merge** on its own (a captured email is an attribute).
  - **Enrichment** (observed preferences, notes, lifecycle *signals*, summaries): AI writes freely.
- This keeps the "source of truth" trustworthy — a hallucinated value can't corrupt identity/consent.

## 8. Compliance primitives (ship with the first commit)

- **Export** a customer's data (per org).  •  **Delete/erasure** (per org).  •  **Rectify** (editable).
- **Consent + suppression:** `emailOptOut`, `marketingConsentAt`; marketing sends MUST check them.
- **Lawful basis by construction** (see §4).  •  **Need-to-know into LLM** (see §7); LLM stays
  no-train / zero-retention.  •  "We don't sell data" stance.

## 9. UI

- **Customers** (list page, sidebar nav): searchable, filterable by `lifecycleStage`; default hides raw
  `lead`. Columns: name, channels, lifecycle, last seen, #orders/spend.
- **Customer profile** (detail view of one person): identity + channels/anchors; **activity timeline**
  (conversations, orders, tickets, bookings — links to authoritative records, not copies); writeable
  **tags / notes / consent**; a **merge** action for suggested duplicates.

## 10. Relationship to the existing `Lead` model

The existing `Lead` is **captured intent** ("wants a quote for X"), not a person. It becomes something
that **links to** a Customer (like orders do). Naming collision with `lifecycleStage: lead` is noted;
optional later rename of the model to `Interest`/`Opportunity`. Not resolved in Stage 1 — just link it.

## 11. Migration approach

Additive and staged: create `Customer` + `CustomerIdentifier` first (no risk to existing flows),
backfill, then add `customerId` to transaction tables **progressively as touched** — never a six-table
big-bang. All schema changes applied manually to the shared Supabase DB (SQL under
`packages/database/prisma/manual/`) alongside the Prisma schema change. Do it on `feature/customer-hub`.

## 12. Out of scope (Stage 2+)

Segmentation/audience rules, custom attributes, broadcast/communications (built on Customer segments +
consent), fuzzy/probabilistic cross-channel matching, lead→opportunity pipeline, dedup automation
beyond exact-anchor.

## 13. Open decisions

- [ ] Entity name at code level — going with **`Customer`** (umbrella) per decision; confirm.
- [x] One-message pings auto-create as `lead` (ungated).  ✅ decided.
- [x] Multi-attendee attendees = ticket data, not Customers.  ✅ decided.
- [ ] Anything in profile v1 beyond identity + timeline + tags/notes/consent?
- [ ] Order to add `customerId` back-links (which module first — likely conversations, since that's
      where anchors are richest).
