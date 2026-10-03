/**
 * tests/property/shelfLife.test.ts
 *
 * Property-based tests for lib/core/shelfLifeCalculator.ts using fast-check.
 * Validates: Requirements 2.6, 2.8 (Properties 3 & 8 in design.md)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeEffectiveDte } from '../../lib/core/shelfLifeCalculator';
import { arbPerishableBatch } from '../arbitraries';

describe('Property 3: Shelf-Life Inverse Monotonicity (Requirement 2.8)', () => {
  it('higher decay factor produces lower or equal effective DTE for positive shelf-life', () => {
    fc.assert(
      fc.property(
        arbPerishableBatch,
        fc.double({ min: 1.0, max: 2.0, noNaN: true }),
        fc.double({ min: 2.01, max: 5.0, noNaN: true }),
        (batch, decayLow, decayHigh) => {
          const nowIso = '2026-10-03T12:00:00Z';
          const resLow = computeEffectiveDte(batch, decayLow, nowIso);
          const resHigh = computeEffectiveDte(batch, decayHigh, nowIso);

          expect(resLow.ok).toBe(true);
          expect(resHigh.ok).toBe(true);

          if (resLow.ok && resHigh.ok) {
            // Higher decay factor implies faster spoilage -> less or equal effective remaining days
            expect(resHigh.effectiveDte).toBeLessThanOrEqual(resLow.effectiveDte);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('Property 8: Sell-Through Probability Bounds (Requirement 2.6)', () => {
  it('sellThroughProbability is strictly bounded in [0.0, 1.0] for any valid input', () => {
    fc.assert(
      fc.property(
        arbPerishableBatch,
        fc.double({ min: 0.1, max: 10.0, noNaN: true }),
        (batch, decayFactor) => {
          const nowIso = '2026-10-03T12:00:00Z';
          const res = computeEffectiveDte(batch, decayFactor, nowIso);

          expect(res.ok).toBe(true);
          if (res.ok) {
            expect(res.sellThroughProbability).toBeGreaterThanOrEqual(0.0);
            expect(res.sellThroughProbability).toBeLessThanOrEqual(1.0);
            expect(res.effectiveDte).toBeGreaterThanOrEqual(0.0);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
