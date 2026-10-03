/**
 * lib/core/pricingEngine.ts — Pure functional dynamic markdown pricing engine.
 *
 * Implements tiered price markdowns, salvage floor clamping, price boundedness,
 * and donation tier handoff per FreshFlow specifications and steering rules.
 *
 * Zero I/O — pure TypeScript with Result<T> error handling.
 */

import type { MarkdownTier, PerishableBatch, PricingDecision } from '../types';

// ---------------------------------------------------------------------------
// Result type for pricing module
// ---------------------------------------------------------------------------

export type PricingResult =
  | { ok: true; value: PricingDecision }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Constants & Rates
// ---------------------------------------------------------------------------

export const DISCOUNT_RATES: Record<MarkdownTier, number> = {
  NONE: 0.0,
  TIER_1: 0.15,
  TIER_2: 0.35,
  TIER_3: 0.50,
  DONATION: 0.0,
};

// ---------------------------------------------------------------------------
// Helper: Financial Rounding (Round-Half-Up to 2 Decimals)
// ---------------------------------------------------------------------------

export function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// evaluatePricingTier
// ---------------------------------------------------------------------------

/**
 * Evaluates the appropriate markdown tier in descending urgency order:
 * DONATION > TIER_3 > TIER_2 > TIER_1 > NONE.
 *
 * Precedence rules (Requirements 3.1, 4.1, 5.1, 5.4, 5.5):
 * 1. DONATION: effectiveDte <= 1.0 AND sellThroughProbability < 0.1
 * 2. TIER_3:   effectiveDte <= 1.0
 * 3. TIER_2:   effectiveDte <= 2.0
 * 4. TIER_1:   effectiveDte <= 3.0 AND sellThroughProbability < 0.8
 * 5. NONE:     otherwise
 */
export function evaluatePricingTier(
  effectiveDte: number,
  sellThroughProbability: number
): MarkdownTier {
  if (effectiveDte <= 1.0 && sellThroughProbability < 0.1) {
    return 'DONATION';
  }
  if (effectiveDte <= 1.0) {
    return 'TIER_3';
  }
  if (effectiveDte <= 2.0) {
    return 'TIER_2';
  }
  if (effectiveDte <= 3.0 && sellThroughProbability < 0.8) {
    return 'TIER_1';
  }
  return 'NONE';
}

// ---------------------------------------------------------------------------
// computeDiscountedPrice
// ---------------------------------------------------------------------------

/**
 * Computes the discounted unit price, enforcing the salvage floor and MSRP ceiling.
 *
 * Invariant: salvageFloor <= price <= msrp (Requirements 3.2, 4.2, 5.2, 8.1, 8.2, 8.3)
 */
export function computeDiscountedPrice(
  msrp: number,
  discountRate: number,
  salvageFloor: number
): { finalPrice: number; rawPrice: number; wasClamped: boolean } {
  const roundedMsrp = roundCurrency(msrp);
  const roundedFloor = roundCurrency(salvageFloor);
  const rawPrice = roundCurrency(roundedMsrp * (1 - discountRate));
  const clamped = Math.max(roundedFloor, Math.min(roundedMsrp, rawPrice));
  const finalPrice = roundCurrency(clamped);
  const wasClamped = finalPrice !== rawPrice;

  return { finalPrice, rawPrice, wasClamped };
}

// ---------------------------------------------------------------------------
// buildPricingDecision
// ---------------------------------------------------------------------------

/**
 * Generates an immutable PricingDecision record for a perishable batch.
 */
export function buildPricingDecision(
  batch: Pick<PerishableBatch, 'batchId' | 'costBasisPerUnit' | 'msrpPerUnit'>,
  effectiveDte: number,
  sellThroughProbability: number,
  evaluatedAtIso?: string
): PricingResult {
  const roundedCost = roundCurrency(batch.costBasisPerUnit);
  const roundedMsrp = roundCurrency(batch.msrpPerUnit);

  // --- Input validation (Requirement 8.4) ---
  if (roundedCost >= roundedMsrp) {
    return {
      ok: false,
      error: 'costBasisPerUnit must be strictly less than msrpPerUnit',
    };
  }

  const evaluatedAt = evaluatedAtIso ?? new Date().toISOString();
  const tier = evaluatePricingTier(effectiveDte, sellThroughProbability);
  const discountRate = DISCOUNT_RATES[tier];

  // --- DONATION tier handling (Requirements 5.4, 8.7) ---
  if (tier === 'DONATION') {
    return {
      ok: true,
      value: {
        batchId: batch.batchId,
        evaluatedAtIso: evaluatedAt,
        effectiveDte,
        sellThroughProbability,
        tier: 'DONATION',
        discountRate: 0.0,
        computedPricePerUnit: null,
        salvageFloorPerUnit: roundedCost,
        msrpPerUnit: roundedMsrp,
        boundednessVerified: false,
        rationale:
          'Batch routed to food bank donation (effective DTE <= 1.0 and sell-through probability < 0.1)',
      },
    };
  }

  // --- Retail markdown computation (Requirements 3.5, 4.4, 5.3, 8.5, 8.6) ---
  const { finalPrice, rawPrice, wasClamped } = computeDiscountedPrice(
    roundedMsrp,
    discountRate,
    roundedCost
  );

  let rationale = `Markdown tier ${tier} (${Math.round(discountRate * 100)}%) applied.`;
  if (wasClamped && rawPrice < roundedCost) {
    rationale += ` Salvage floor enforced ($${finalPrice.toFixed(2)} instead of pre-floor $${rawPrice.toFixed(2)}).`;
  }

  return {
    ok: true,
    value: {
      batchId: batch.batchId,
      evaluatedAtIso: evaluatedAt,
      effectiveDte,
      sellThroughProbability,
      tier,
      discountRate,
      computedPricePerUnit: finalPrice,
      salvageFloorPerUnit: roundedCost,
      msrpPerUnit: roundedMsrp,
      boundednessVerified: true,
      rationale,
    },
  };
}
