/**
 * tests/property/thermalDecay.test.ts
 *
 * Property-based tests for lib/core/thermalCalculator.ts using fast-check.
 * Validates: Requirements 1.2, 1.3, 1.7 (Properties 1 & 2 in design.md)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeThermalDecayFactor } from '../../lib/core/thermalCalculator';
import {
  arbThermalFactorsArrhenius,
  arbThermalFactorsQ10,
  arbTemperatureReading,
} from '../arbitraries';

describe('Property 1: Thermal Monotonicity (Requirement 1.7)', () => {
  it('strictly increases decay factor as mean temperature increases above reference (Q10 path)', () => {
    fc.assert(
      fc.property(
        arbThermalFactorsQ10,
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        (factors, delta1, delta2) => {
          // Ensure tLow < tHigh
          const tLow = factors.referenceTemperatureCelsius + Math.min(delta1, delta2);
          const tHigh = factors.referenceTemperatureCelsius + Math.max(delta1, delta2) + 0.05;

          const historyLow = [{ timestampIso: '2026-10-03T00:00:00Z', celsius: Math.min(59, tLow) }];
          const historyHigh = [{ timestampIso: '2026-10-03T00:00:00Z', celsius: Math.min(60, tHigh) }];

          const resLow = computeThermalDecayFactor(historyLow, factors);
          const resHigh = computeThermalDecayFactor(historyHigh, factors);

          expect(resLow.ok).toBe(true);
          expect(resHigh.ok).toBe(true);

          if (resLow.ok && resHigh.ok) {
            expect(resHigh.value.computedDecayFactor).toBeGreaterThan(
              resLow.value.computedDecayFactor
            );
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('strictly increases decay factor as mean temperature increases above reference (Arrhenius path)', () => {
    fc.assert(
      fc.property(
        arbThermalFactorsArrhenius,
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        (factors, delta1, delta2) => {
          const tLow = factors.referenceTemperatureCelsius + Math.min(delta1, delta2);
          const tHigh = factors.referenceTemperatureCelsius + Math.max(delta1, delta2) + 0.05;

          const historyLow = [{ timestampIso: '2026-10-03T00:00:00Z', celsius: Math.min(59, tLow) }];
          const historyHigh = [{ timestampIso: '2026-10-03T00:00:00Z', celsius: Math.min(60, tHigh) }];

          const resLow = computeThermalDecayFactor(historyLow, factors);
          const resHigh = computeThermalDecayFactor(historyHigh, factors);

          expect(resLow.ok).toBe(true);
          expect(resHigh.ok).toBe(true);

          if (resLow.ok && resHigh.ok) {
            expect(resHigh.value.computedDecayFactor).toBeGreaterThan(
              resLow.value.computedDecayFactor
            );
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('Property 2: Reference Temperature Identity (Requirement 1.2)', () => {
  it('produces computedDecayFactor = 1.0 when mean equals reference temperature', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbThermalFactorsQ10, arbThermalFactorsArrhenius),
        fc.integer({ min: 1, max: 24 }),
        (factors, count) => {
          // Build history where all readings equal the reference temperature exactly
          const history = Array.from({ length: count }, (_, i) => ({
            timestampIso: new Date(Date.now() + i * 3600_000).toISOString(),
            celsius: factors.referenceTemperatureCelsius,
          }));

          const res = computeThermalDecayFactor(history, factors);

          expect(res.ok).toBe(true);
          if (res.ok) {
            expect(res.value.computedDecayFactor).toBeCloseTo(1.0, 5);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
