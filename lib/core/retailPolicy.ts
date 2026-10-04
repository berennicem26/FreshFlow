/**
 * lib/core/retailPolicy.ts — Retail markdown & donation timing policy (pure constants).
 *
 * Single source of truth shared by the pricing engine and the donation router.
 * "Days left" always means effective (temperature-adjusted) days until the product's date.
 *
 * Grounding in real-world practice:
 *  - Supermarkets apply clearance stickers 1–5 days before the sell-by date
 *    (e.g. Kroger "Reduced" stickers 1–2 days out).
 *  - Food banks require usable shelf-life on arrival: produce ≥ 5 days, packaged cut
 *    produce ≥ 3 days before code date (St. Mary's Food Bank Perishable Guidelines 2025).
 *    A donation must therefore leave at least ~1 day for pickup + distribution.
 *  - Shoppers need time to use the product at home (USDA: raw meat cooked or frozen
 *    within 1–2 days), so discounted stock is still sold with ≥ 2 days left.
 *
 * Schedule (descending urgency):
 *   days < 1.0                              → PULL      (too late for shoppers or food banks)
 *   days ≤ 2.0                              → DONATION  (keep ≥ 1 day buffer for the food bank)
 *   days ≤ 3.0 AND sell-through < 0.5       → DONATION  (won't sell in time — donate early)
 *   days ≤ 3.0                              → TIER_3 (-50%)
 *   days ≤ 4.0                              → TIER_2 (-35%)
 *   days ≤ 5.0 AND sell-through < 0.9       → TIER_1 (-15%) (slow sellers only)
 *   otherwise                               → NONE (full price)
 */

/** Below this many days, product is pulled from sale; not eligible for donation. */
export const PULL_BELOW_DTE = 1.0;

/** At or below this many days, every remaining unit is donated (food bank buffer). */
export const DONATION_DTE = 2.0;

/** At or below this many days, slow-selling stock is donated early. */
export const EARLY_DONATION_DTE = 3.0;

/** Sell-through probability below which early donation is triggered. */
export const EARLY_DONATION_STP = 0.5;

/** Final markdown window (-50%). */
export const TIER_3_DTE = 3.0;

/** Mid markdown window (-35%). */
export const TIER_2_DTE = 4.0;

/** Early markdown window (-15%), applied only to slow sellers. */
export const TIER_1_DTE = 5.0;

/** Sell-through probability below which an early markdown is needed. */
export const TIER_1_STP = 0.9;
