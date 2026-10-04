/**
 * tests/core/storageProfile.test.ts
 *
 * Verifies outdoor temperature is translated into realistic product temperatures:
 * coolers stay near 4°C, room-temperature shelves follow a dampened indoor temperature.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  estimateProductTemperatureC,
  resolveStorageZone,
  ZONE_REFERENCE_C,
} from '../../lib/core/storageProfile';

describe('storageProfile', () => {
  it('keeps refrigerated products at 4°C on a normal 20°C day', () => {
    expect(estimateProductTemperatureC('refrigerated', 20)).toBe(4);
  });

  it('warms refrigerated products only modestly in a 35°C heatwave', () => {
    const t = estimateProductTemperatureC('refrigerated', 35);
    expect(t).toBeCloseTo(6.25, 2);
    expect(t).toBeLessThanOrEqual(8); // stays inside the 2–8°C display-case band
  });

  it('keeps room-temperature shelves at 20°C on a normal day and ~26°C in a heatwave', () => {
    expect(estimateProductTemperatureC('ambient', 20)).toBe(20);
    expect(estimateProductTemperatureC('ambient', 35)).toBeCloseTo(26, 5);
  });

  it('defaults zones by category and honors explicit overrides', () => {
    expect(resolveStorageZone({ category: 'dairy' })).toBe('refrigerated');
    expect(resolveStorageZone({ category: 'bakery' })).toBe('ambient');
    expect(resolveStorageZone({ category: 'produce', storageZone: 'refrigerated' })).toBe('refrigerated');
  });

  it('product temperature never decreases as outdoor temperature rises (both zones)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('refrigerated' as const, 'ambient' as const),
        fc.double({ min: -10, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (zone, outdoor, delta) => {
          expect(estimateProductTemperatureC(zone, outdoor + delta)).toBeGreaterThanOrEqual(
            estimateProductTemperatureC(zone, outdoor)
          );
        }
      ),
      { numRuns: 300 }
    );
  });

  it('refrigerated products never fall below their 4°C reference', () => {
    fc.assert(
      fc.property(fc.double({ min: -30, max: 60, noNaN: true }), (outdoor) => {
        expect(estimateProductTemperatureC('refrigerated', outdoor)).toBeGreaterThanOrEqual(
          ZONE_REFERENCE_C.refrigerated
        );
      }),
      { numRuns: 300 }
    );
  });
});
