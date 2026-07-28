/**
 * Shared gross-up for Paystack subaccount split payments. When an org has a connected payout
 * subaccount, the customer is charged a grossed-up total so BOTH Paystack's own processing fee and
 * Zuti's platform fee are added on top of the price, instead of being deducted from it — the
 * organiser's subaccount always settles for exactly the full price, never less.
 *
 * Mechanism: `transaction_charge` (a flat kobo amount routed to Zuti's MAIN account) overrides
 * whatever `percentage_charge` is stored on the subaccount, so the split is exact and doesn't depend
 * on that stored value being correct. Paired with `bearer: 'account'`, Paystack deducts its own
 * actual processing fee from Zuti's cut (not the subaccount's) — so any gap between our fee ESTIMATE
 * below and Paystack's real fee is absorbed by Zuti, never the organiser.
 *
 * Verified against Paystack's own docs (2026-07): `percentage_charge` is the PLATFORM's share (not
 * the subaccount's — a prior, uncorrected assumption in this codebase had this backwards), and
 * `transaction_charge` sends its flat amount to the main account with the subaccount keeping the
 * rest — https://support.paystack.com/en/articles/2132802.
 */
export interface GrossUpResult {
  /** Total the customer is charged (in minor units). */
  gross: number;
  /** Flat amount (in minor units) routed to Zuti's main account via `transaction_charge`. */
  transactionCharge: number;
}

/** Zuti's platform fee, as a fraction of the base price. Kept in one place — every split payment
 *  (events, commerce) must use the same rate. */
export const PLATFORM_FEE_RATE = 0.05; // 5%
/** Matches Paystack Nigeria's standard local-card pricing, used only to ESTIMATE the gross-up —
 *  Paystack's actual fee is what it is; `bearer: 'account'` means any estimation error is absorbed
 *  by Zuti's cut, never the organiser's settlement. */
const PAYSTACK_RATE = 0.015; // 1.5% of the gross charge
const PAYSTACK_FLAT_KOBO = 10_000; // ₦100, applied once the gross exceeds the threshold below
const PAYSTACK_FLAT_THRESHOLD_KOBO = 250_000; // ₦2,500
const PAYSTACK_FEE_CAP_KOBO = 200_000; // ₦2,000

/**
 * Gross up `baseMinor` (the price the organiser should net) so that, after Paystack's processing fee
 * and Zuti's platform fee are both added on top, the subaccount still settles for exactly
 * `baseMinor`. Returns `{ gross: baseMinor, transactionCharge: 0 }` unchanged when there's nothing to
 * gross up (e.g. a free ticket) — callers should only apply this when the org has a subaccount.
 */
export function computeGrossUpForSubaccount(baseMinor: number): GrossUpResult {
  if (baseMinor <= 0) return { gross: 0, transactionCharge: 0 };
  const platformFee = Math.ceil(baseMinor * PLATFORM_FEE_RATE);
  const base = baseMinor + platformFee;

  // Solve gross = base + paystackFee(gross) iteratively — converges in ≤ 3 steps since the fee is a
  // small fraction of gross (a fixed-point iteration, not a closed form, because the flat/cap
  // thresholds are themselves functions of the still-unknown gross).
  let gross = base;
  for (let i = 0; i < 3; i++) {
    const flat = gross > PAYSTACK_FLAT_THRESHOLD_KOBO ? PAYSTACK_FLAT_KOBO : 0;
    gross = base + Math.min(PAYSTACK_FEE_CAP_KOBO, Math.ceil(gross * PAYSTACK_RATE) + flat);
  }
  const flat = gross > PAYSTACK_FLAT_THRESHOLD_KOBO ? PAYSTACK_FLAT_KOBO : 0;
  const paystackFee = Math.min(PAYSTACK_FEE_CAP_KOBO, Math.ceil(gross * PAYSTACK_RATE) + flat);
  gross = base + paystackFee;
  return { gross, transactionCharge: platformFee + paystackFee };
}
