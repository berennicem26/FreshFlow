/**
 * tests/property/pricing.test.ts
 *
 * Property-based tests for lib/core/pricingEngine.ts using fast-check.
 * Validates: Requirements 3.1, 4.1, 4.5, 5.1, 8.1, 8.5, 8.6 (Properties 4 & 5 in design.md)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildPricingDecision,
  evaluatePricingTier,
  DISCOUNT_RATES,
} from '../../lib/core/pricingEngine';
import { arbPerishableBatch } from '../arbitraries';

const TIER_URGENCY: Record<string, number> = {
  NONE: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
  DONATION: 4,
};

describe('Property 4: Universal Price Boundedness (Requirements 8.1, 8.5, 8.6)', () => {
  it('enforces costBasis <= computedPrice <= msrp and boundednessVerified=true for all retail decisions', () => {
    fc.assert(
      fc.property(
        arbPerishableBatch,
        fc.double({ min: 0.1, max: 10.0, noNaN: true }),
        fc.double({ min: 0.15, max: 1.0, noNaN: true }), // STP >= 0.15 avoids DONATION tier
        (batch, dte, stp) => {
          const res = buildPricingDecision(batch, dte, stp, '2026-10-03T12:00:00Z');

          expect(res.ok).toBe(true);
          if (res.ok) {
            const decision = res.value;
            if (decision.tier !== 'DONATION') {
              expect(decision.computedPricePerUnit).not.toBeNull();
              expect(decision.computedPricePerUnit!).toBeGreaterThanOrEqual(
                batch.costBasisPerUnit
              );
              expect(decision.computedPricePerUnit!).toBeLessThanOrEqual(
                batch.msrpPerUnit
              );
              expect(decision.boundednessVerified).toBe(true);
            }
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('Property 5: Tier Escalation & Monotonicity (Requirements 4.5, 5.5)', () => {
  it('assigns greater or equal tier urgency as effective DTE decreases', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 2.0, noNaN: true }),
        fc.double({ min: 2.01, max: 10.0, noNaN: true }),
        fc.double({ min: 0.0, max: 1.0, noNaN: true }),
        (dteLow, dteHigh, stp) => {
          const tierHigherUrgency = evaluatePricingTier(dteLow, stp);
          const tierLowerUrgency = evaluatePricingTier(dteHigh, stp);

          expect(TIER_URGENCY[tierHigherUrgency]).toBeGreaterThanOrEqual(
            TIER_URGENCY[tierLowerUrgency]
          );
        }
      ),
      { numRuns: 500 }
    );
  });

  it('discount rates are monotonically non-decreasing as DTE decreases (for retail tiers)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 2.0, noNaN: true }),
        fc.double({ min: 2.01, max: 10.0, noNaN: true }),
        (dteLow, dteHigh) => {
          // Fixed moderate sell-through probability
          const stp = 0.5;
          const tierLow = evaluatePricingTier(dteLow, stp);
          const tierHigh = evaluatePricingTier(dteHigh, stp);

          expect(DISCOUNT_RATES[tierLow]).toBeGreaterThanOrEqual(DISCOUNT_RATES[tierHigh]);
        }
      ),
      { numRuns: 300 }
    );
  });
});
