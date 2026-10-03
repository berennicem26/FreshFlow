/**
 * lib/core/shelfLifeCalculator.ts
 *
 * Pure functional module — Functional Core, zero I/O, zero side effects.
 *
 * Computes biologically adjusted effective days-to-expiry (effectiveDte) and
 * sell-through probability for a perishable batch, given a thermal decay factor
 * produced by the Thermal Calculator.
 *
 * Rules:
 *  - No imports beyond types (lib/types.ts)
 *  - No I/O, no Date.now() without injection, no console.log, no global state
 *  - All domain validation errors returned as Result<T> — never thrown
 *  - Clock injected via optional `nowIso?: string` (Rule 1.3)
 */

import type { PerishableBatch } from '../types';

// ---------------------------------------------------------------------------
// Result type — localised alias matching the canonical Result<T> shape
// ---------------------------------------------------------------------------

/**
 * ShelfLifeResult — discriminated union returned by `computeEffectiveDte`.
 *
 * On success: carries effectiveDte (decimal days, >= 0) and
 *             sellThroughProbability (clamped to [0.0, 1.0]).
 * On failure: carries a descriptive domain error string.
 */
export type ShelfLifeResult =
  | { ok: true; effectiveDte: number; sellThroughProbability: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// computeEffectiveDte
// ---------------------------------------------------------------------------

/**
 * Computes the biologically adjusted effective days-to-expiry and the
 * sell-through probability for a perishable batch.
 *
 * @param batch       - A subset of PerishableBatch providing the fields needed
 *                      for DTE and sell-through calculations.
 * @param decayFactor - The dimensionless thermal decay factor (must be > 0).
 *                      A value of 1.0 means no acceleration; > 1.0 means the
 *                      product spoils faster than at reference temperature.
 * @param nowIso      - Optional ISO 8601 string representing "now" for
 *                      deterministic testing (Rule 1.3 injectable clock).
 *                      Defaults to `new Date().toISOString()` when absent.
 *
 * @returns ShelfLifeResult — { ok: true, effectiveDte, sellThroughProbability }
 *                          or { ok: false, error } on validation failure.
 *
 * Validation order (Requirements 2.5, 2.7):
 *  1. decayFactor <= 0  → "computedDecayFactor must be positive"
 *  2. quantityOnHand <= 0 → "quantityOnHand must be greater than zero"
 *  3. dailySalesVelocity < 0 → "dailySalesVelocity must be non-negative"
 *
 * Computation (Requirements 2.1, 2.2, 2.3, 2.4, 2.6):
 *  - nominalRemainingDays = (Date.parse(expiryDateIso) − Date.parse(now)) / 86_400_000
 *  - effectiveDte = nominalRemainingDays <= 0 ? 0.0 : nominalRemainingDays / decayFactor
 *  - sellThroughProbability = Math.min(1.0, (effectiveDte × dailySalesVelocity) / quantityOnHand)
 */
export function computeEffectiveDte(
  batch: Pick<PerishableBatch, 'expiryDateIso' | 'quantityOnHand' | 'dailySalesVelocity'>,
  decayFactor: number,
  nowIso?: string
): ShelfLifeResult {
  // --- Input validation (Requirement 2.5, 2.7) ---

  if (decayFactor <= 0) {
    return { ok: false, error: 'computedDecayFactor must be positive' };
  }

  if (batch.quantityOnHand <= 0) {
    return { ok: false, error: 'quantityOnHand must be greater than zero' };
  }

  if (batch.dailySalesVelocity < 0) {
    return { ok: false, error: 'dailySalesVelocity must be non-negative' };
  }

  // --- Injectable clock (Architecture Rule 1.3) ---
  // Use the injected timestamp when provided; fall back to the real clock
  // only when nowIso is absent. This keeps the function deterministic in tests.
  const now = nowIso ?? new Date().toISOString();

  // --- Nominal remaining days (Requirement 2.1) ---
  // Both timestamps are parsed to milliseconds since epoch via Date.parse;
  // dividing by 86_400_000 converts ms to fractional days.
  const nominalRemainingDays =
    (Date.parse(batch.expiryDateIso) - Date.parse(now)) / 86_400_000;

  // --- Effective DTE (Requirements 2.1, 2.2, 2.3, 2.4) ---
  // Clamp to 0 when already expired or expiring today (nominalRemainingDays <= 0).
  // When decayFactor > 1.0 the result is strictly less than nominalRemainingDays,
  // satisfying the inverse monotonicity invariant (Requirement 2.8).
  const effectiveDte: number =
    nominalRemainingDays <= 0 ? 0.0 : nominalRemainingDays / decayFactor;

  // --- Sell-through probability (Requirement 2.6) ---
  // Represents the fraction of quantityOnHand that can be sold before effectiveDte
  // expires at the current dailySalesVelocity. Clamped to [0.0, 1.0].
  const sellThroughProbability: number = Math.min(
    1.0,
    (effectiveDte * batch.dailySalesVelocity) / batch.quantityOnHand
  );

  return { ok: true, effectiveDte, sellThroughProbability };
}
