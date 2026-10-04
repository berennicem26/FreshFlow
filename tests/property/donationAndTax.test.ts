/**
 * tests/property/donationAndTax.test.ts
 *
 * Property-based tests for lib/core/donationRouter.ts and lib/core/taxValuator.ts.
 * Validates: Requirements 6.6, 7.1, 7.2, 7.3, 7.5 (Properties 6 & 7 in design.md)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { shouldDonate } from '../../lib/core/donationRouter';
import { evaluatePricingTier } from '../../lib/core/pricingEngine';
import { computeIrsDeduction } from '../../lib/core/taxValuator';

describe('Property 6: IRS Deduction Correctness & Bounds (Requirements 7.1, 7.2, 7.3, 7.5)', () => {
  it('enforces costBasisTotal <= irsDeductionAmount <= 2 * costBasisTotal for all valid donation valuations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }), // units
        fc.double({ min: 0.5, max: 100.0, noNaN: true }).map((v) => Number(v.toFixed(2))),
        fc.double({ min: 1.0, max: 10000.0, noNaN: true }).map((v) => Number(v.toFixed(2))),
        (units, fmvPerUnit, costBasisTotal) => {
          const res = computeIrsDeduction(units, fmvPerUnit, costBasisTotal);

          expect(res.ok).toBe(true);
          if (res.ok) {
            const { irsDeductionAmount, totalFairMarketValue, costBasisTotal: cleanCost } = res.value;

            // Invariant: costBasisTotal <= deduction <= 2 * costBasisTotal
            expect(irsDeductionAmount).toBeGreaterThanOrEqual(cleanCost);
            expect(irsDeductionAmount).toBeLessThanOrEqual(2 * cleanCost + 0.01);

            // Branch check: If FMV <= costBasisTotal, deduction equals costBasisTotal
            if (totalFairMarketValue <= cleanCost) {
              expect(irsDeductionAmount).toBe(cleanCost);
            }
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('Property 7: No Premature or Too-Late Donation (Requirement 6.6)', () => {
  it('never donates while stock can still sell (DTE > 3.0, or DTE > 2.0 with STP >= 0.5)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 2.0001, max: 30.0, noNaN: true }),
        fc.double({ min: 0.0, max: 1.0, noNaN: true }),
        (dte, stp) => {
          fc.pre(dte > 3.0 || stp >= 0.5);
          expect(shouldDonate(dte, stp)).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('never donates with less than 1 day left (food bank cannot use it in time)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 0.9999, noNaN: true }),
        fc.double({ min: 0.0, max: 1.0, noNaN: true }),
        (dte, stp) => {
          expect(shouldDonate(dte, stp)).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('donation eligibility always agrees with the DONATION pricing tier', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 10.0, noNaN: true }),
        fc.double({ min: 0.0, max: 1.0, noNaN: true }),
        (dte, stp) => {
          expect(shouldDonate(dte, stp)).toBe(evaluatePricingTier(dte, stp) === 'DONATION');
        }
      ),
      { numRuns: 500 }
    );
  });
});
