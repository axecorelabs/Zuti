# Data Protection & Compliance Posture

> Practical engineering guide, **not legal advice**. Confirm specifics with counsel for the
> jurisdictions your organizations and their customers actually operate in. The goal here is
> **compliant-by-default**: build the primitives in from the first commit rather than retrofitting.

Zuti stores personal data about **end-customers** (people who message a bot, register for events,
buy products, book meetings) on behalf of the **organizations** that use Zuti. Because we touch this
data, how we design features is a compliance decision, not an afterthought.

## 1. Roles — who owns which obligation

- **Organizations = data controllers.** They decide to collect their customers' data and for what.
  They own: lawful basis, privacy notices to their customers, and honoring rights requests.
- **Zuti = data processor** (GDPR) / **service provider** (CCPA/CPRA). We process only on the org's
  instruction, keep data secure, and **give orgs the tooling to comply** (export, delete, opt-out).
  We do **not** obtain the end-customer's consent — we enable the org to.

Platform-level artifacts this implies: a **DPA** in our terms, a **privacy policy**, a disclosed
**sub-processor list**, and strict **per-tenant isolation** (already enforced via `orgId` scoping).

## 2. Regimes we build for

Build to a **GDPR baseline** (the strictest); it covers ~90% of the rest. Deltas are defaults,
thresholds, and paperwork — not separate systems.

| Regime | Applies when | Distinctive requirement |
|---|---|---|
| **GDPR** (EU/EEA) | Any org or their customers in the EU — our being in Nigeria does **not** exempt us | Marketing needs **opt-in** consent; full data-subject rights; 72h breach notice; transfer mechanism |
| **UK GDPR / DPA 2018** | UK customers | Essentially GDPR |
| **NDPA 2023 / NDPR** (Nigeria) | Our home base (Paystack/NGN) | Controller/processor duties, data-subject rights, possible NDPC registration above thresholds |
| **CCPA / CPRA** (California) | For-profit businesses over thresholds (~$25M rev, 100k+ consumers, or ≥50% rev from selling data) | **Opt-out of "sale/sharing"** model; "Do Not Sell or Share" — *light for us because we don't sell data* |
| **US state patchwork** (VA, CO, CT, TX, …), **LGPD** (Brazil), **PIPEDA/CASL** (Canada) | Respective residents | Almost all GDPR- or CCPA-shaped; same primitives satisfy them |

## 3. Principles that constrain design

- **Lawful basis** — prefer people with a real relationship (registered, purchased, booked → basis is
  "contract"). Anonymous inbound pings have weak basis and little value.
- **Data minimization** — do **not** vacuum up every person who ever messaged. Store people with a
  transactional or clearly-engaged relationship. (This is why "Customers" is derived from transactions,
  not "everyone who messaged.")
- **Purpose limitation** — data collected to fulfil an order/support must **not** be silently
  repurposed for marketing.

## 4. Transactional vs marketing — the line every comms feature respects

- **Transactional** (ticket, receipt, order/booking update, "event moved to Hall B") — OK to send to
  anyone who transacted; it fulfils the relationship.
- **Marketing / promotional** ("check out our next event") — requires **opt-in consent** (EU/GDPR) or
  at minimum a **clear opt-out** (US). Must honor a **suppression flag** and include **unsubscribe**.

Design rule: **tag every outbound message as transactional or marketing**, and gate marketing on the
consent/suppression flag. Never auto-enroll transactional contacts into marketing.

## 5. Required primitives — build these in from day one

Any feature touching customer data or communications must ship with:

1. **Per-person, per-channel consent + suppression flag** (opt-in capable, so EU-safe by default; can
   downgrade to opt-out where allowed). Marketing sends MUST check it.
2. **Unsubscribe link** in every marketing email; honoring it flips the flag.
3. **Per-person data export** (right of access / portability), scoped per org.
4. **Per-person delete / erasure** ("delete this customer's data"), scoped per org.
5. **Rectification** — customer records must be editable/correctable.
6. **"We don't sell or share data" disclosure** (covers CCPA's headline ask; trivial while true).

## 6. Sub-processors, international transfers & the AI pipeline ⚠️

The easy-to-miss, Zuti-specific risk. We hand personal data to third parties:

- **Supabase** (database), **ZeptoMail** (email), **Paystack** (payments), and — critically —
  **OpenRouter / the LLM providers** (the AI reads customer messages).

Obligations:
- **Disclose every sub-processor** (privacy policy + DPA), including the LLM provider.
- Customer data reaching a US-based LLM is a **cross-border transfer** → needs a mechanism
  (SCCs / adequacy) when EU data is involved.
- **Verify LLM terms are no-train / zero-retention** (OpenRouter allows per-provider data-policy
  controls) — customer messages must not be used to train models or be retained by the provider.

## 7. Retention & security

- Define **retention** — don't keep customer data or conversations forever; plan deletion/anonymization.
- Baseline **security** for PII (already: per-tenant isolation, hosted DB). PII raises the stakes —
  breaches carry **72h notification** duties under GDPR/NDPA.
- **Caution on custom fields** — event/registration custom fields can inadvertently collect
  special-category data (health, etc.). Avoid designing prompts/fields that solicit sensitive data.

## 8. Net design posture

Build to a **GDPR baseline**, make **marketing consent-based**, **disclose sub-processors (LLM
included)**, confirm **no-train LLM terms**, and ship the **export / delete / opt-out** primitives with
the first commit of any customer-data or communications feature. That single posture covers GDPR,
UK GDPR, NDPA, CCPA/CPRA, and the state/international patchwork at once.
