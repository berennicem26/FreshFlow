/**
 * tests/core/pricingEngine.test.ts
 *
 * Unit tests for pricing engine boundary conditions and salvage floor clamping.
 * Validates: Requirements 3.1, 3.3, 3.4, 4.1, 4.3, 5.1, 5.4, 8.4, 8.7
 */

import { describe, it, expect } from 'vitest';
import {
  evaluatePricingTier,
  computeDiscountedPrice,
  buildPricingDecision,
} from '../../lib/core/pricingEngine';

describe('pricingEngine unit tests', () => {
  const baseBatch = {
    batchId: 'BATCH-001',
    costBasisPerUnit: 3.0,
    msrpPerUnit: 6.0,
  };

  const nowIso = '2026-10-03T12:00:00Z';

  it('assigns TIER_1 (15%) when DTE <= 3.0 and STP < 0.8', () => {
    const tier = evaluatePricingTier(2.5, 0.7);
    expect(tier).toBe('TIER_1');

    const res = buildPricingDecision(baseBatch, 2.5, 0.7, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.tier).toBe('TIER_1');
      expect(res.value.discountRate).toBe(0.15);
      // 6.00 * 0.85 = 5.10
      expect(res.value.computedPricePerUnit).toBe(5.1);
    }
  });

  it('assigns NONE when DTE <= 3.0 but STP >= 0.8 (stock selling fine)', () => {
    const tier = evaluatePricingTier(2.5, 0.85);
    expect(tier).toBe('NONE');
  });

  it('assigns TIER_2 (35%) when DTE <= 2.0 regardless of STP', () => {
    const tier = evaluatePricingTier(1.8, 0.95);
    expect(tier).toBe('TIER_2');

    const res = buildPricingDecision(baseBatch, 1.8, 0.95, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 6.00 * 0.65 = 3.90
      expect(res.value.computedPricePerUnit).toBe(3.9);
    }
  });

  it('assigns TIER_3 (50%) when DTE <= 1.0 and STP >= 0.1', () => {
    const tier = evaluatePricingTier(0.8, 0.2);
    expect(tier).toBe('TIER_3');

    const res = buildPricingDecision(baseBatch, 0.8, 0.2, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 6.00 * 0.50 = 3.00 (equals costBasis)
      expect(res.value.computedPricePerUnit).toBe(3.0);
    }
  });

  it('assigns DONATION when DTE <= 1.0 and STP < 0.1', () => {
    const tier = evaluatePricingTier(0.8, 0.05);
    expect(tier).toBe('DONATION');

    const res = buildPricingDecision(baseBatch, 0.8, 0.05, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.tier).toBe('DONATION');
      expect(res.value.computedPricePerUnit).toBeNull();
      expect(res.value.boundednessVerified).toBe(false);
      expect(res.value.rationale).toContain('Batch routed to food bank donation');
    }
  });

  it('clamps price to salvage floor and updates rationale when discount exceeds cost basis', () => {
    const thinMarginBatch = {
      batchId: 'BATCH-THIN',
      costBasisPerUnit: 4.5,
      msrpPerUnit: 6.0,
    };

    // 50% discount on $6.00 would be $3.00, below cost $4.50
    const res = buildPricingDecision(thinMarginBatch, 0.9, 0.5, nowIso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.computedPricePerUnit).toBe(4.5);
      expect(res.value.rationale).toContain('Salvage floor enforced');
      expect(res.value.rationale).toContain('$4.50 instead of pre-floor $3.00');
    }
  });

  it('rejects batch where costBasis >= msrp', () => {
    const invalidBatch = {
      batchId: 'BATCH-ERR',
      costBasisPerUnit: 8.0,
      msrpPerUnit: 6.0,
    };

    const res = buildPricingDecision(invalidBatch, 2.0, 0.5, nowIso);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('costBasisPerUnit must be strictly less than msrpPerUnit');
    }
  });
});
