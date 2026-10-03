/**
 * tests/core/shelfLifeCalculator.test.ts
 *
 * Unit tests for edge cases and validations in lib/core/shelfLifeCalculator.ts.
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7
 */

import { describe, it, expect } from 'vitest';
import { computeEffectiveDte } from '../../lib/core/shelfLifeCalculator';

describe('shelfLifeCalculator edge cases & validations', () => {
  const baseBatch = {
    expiryDateIso: '2026-10-10T12:00:00Z',
    quantityOnHand: 100,
    dailySalesVelocity: 15,
  };

  const nowIso = '2026-10-03T12:00:00Z'; // 7 nominal days remaining

  it('rejects decayFactor <= 0', () => {
    const res = computeEffectiveDte(baseBatch, 0, nowIso);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('computedDecayFactor must be positive');
    }
  });

  it('rejects quantityOnHand <= 0', () => {
    const res = computeEffectiveDte({ ...baseBatch, quantityOnHand: 0 }, 1.5, nowIso);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('quantityOnHand must be greater than zero');
    }
  });

  it('rejects negative dailySalesVelocity', () => {
    const res = computeEffectiveDte({ ...baseBatch, dailySalesVelocity: -1 }, 1.5, nowIso);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('dailySalesVelocity must be non-negative');
    }
  });

  it('returns effectiveDte = 0.0 for already expired batch without error', () => {
    const expiredBatch = {
      ...baseBatch,
      expiryDateIso: '2026-10-01T12:00:00Z', // 2 days in the past
    };
    const res = computeEffectiveDte(expiredBatch, 1.5, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.effectiveDte).toBe(0.0);
      expect(res.sellThroughProbability).toBe(0.0);
    }
  });

  it('preserves nominal shelf life when decayFactor is exactly 1.0', () => {
    const res = computeEffectiveDte(baseBatch, 1.0, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.effectiveDte).toBeCloseTo(7.0, 4);
    }
  });

  it('halves effective shelf life when decayFactor is 2.0', () => {
    const res = computeEffectiveDte(baseBatch, 2.0, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.effectiveDte).toBeCloseTo(3.5, 4);
    }
  });

  it('clamps sellThroughProbability to 1.0 when velocity exceeds inventory need', () => {
    // 7 days * 50 units/day = 350 units demand vs 100 on hand -> 100% sell-through
    const highVelocityBatch = {
      ...baseBatch,
      dailySalesVelocity: 50,
    };
    const res = computeEffectiveDte(highVelocityBatch, 1.0, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sellThroughProbability).toBe(1.0);
    }
  });
});
