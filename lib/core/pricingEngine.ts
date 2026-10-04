/**
 * lib/core/pricingEngine.ts — Pure functional dynamic markdown pricing engine.
 *
 * Implements tiered price markdowns, salvage floor clamping, price boundedness,
 * and donation tier handoff per FreshFlow specifications and steering rules.
 *
 * Zero I/O — pure TypeScript with Result<T> error handling.
 */

import type { MarkdownTier, PerishableBatch, PricingDecision } from '../types';
import {
  PULL_BELOW_DTE,
  DONATION_DTE,
  EARLY_DONATION_DTE,
  EARLY_DONATION_STP,
  TIER_3_DTE,
  TIER_2_DTE,
  TIER_1_DTE,
  TIER_1_STP,
} from './retailPolicy';

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
  PULL: 0.0,
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
 * PULL > DONATION > TIER_3 > TIER_2 > TIER_1 > NONE.
 *
 * Thresholds live in ./retailPolicy.ts (grounded in retail & food-bank practice):
 * 1. PULL:     effectiveDte < 1.0  (too late for shoppers or food banks)
 * 2. DONATION: effectiveDte <= 2.0 (keep >= 1 day buffer for food bank pickup)
 * 3. DONATION: effectiveDte <= 3.0 AND sellThroughProbability < 0.5 (won't sell in time)
 * 4. TIER_3:   effectiveDte <= 3.0
 * 5. TIER_2:   effectiveDte <= 4.0
 * 6. TIER_1:   effectiveDte <= 5.0 AND sellThroughProbability < 0.9
 * 7. NONE:     otherwise
 */
export function evaluatePricingTier(
  effectiveDte: number,
  sellThroughProbability: number
): MarkdownTier {
  if (effectiveDte < PULL_BELOW_DTE) {
    return 'PULL';
  }
  if (effectiveDte <= DONATION_DTE) {
    return 'DONATION';
  }
  if (effectiveDte <= EARLY_DONATION_DTE && sellThroughProbability < EARLY_DONATION_STP) {
    return 'DONATION';
  }
  if (effectiveDte <= TIER_3_DTE) {
    return 'TIER_3';
  }
  if (effectiveDte <= TIER_2_DTE) {
    return 'TIER_2';
  }
  if (effectiveDte <= TIER_1_DTE && sellThroughProbability < TIER_1_STP) {
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

  // --- Non-retail outcomes: DONATION and PULL (Requirements 5.4, 8.7) ---
  if (tier === 'DONATION' || tier === 'PULL') {
    return {
      ok: true,
      value: {
        batchId: batch.batchId,
        evaluatedAtIso: evaluatedAt,
        effectiveDte,
        sellThroughProbability,
        tier,
        discountRate: 0.0,
        computedPricePerUnit: null,
        salvageFloorPerUnit: roundedCost,
        msrpPerUnit: roundedMsrp,
        boundednessVerified: false,
        rationale:
          tier === 'DONATION'
            ? `Batch routed to food bank donation (${effectiveDte.toFixed(1)} days left — enough time for pickup and distribution, too little to sell through).`
            : `Batch pulled from sale (${effectiveDte.toFixed(1)} days left — below the 1-day minimum for shoppers and food banks).`,
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
