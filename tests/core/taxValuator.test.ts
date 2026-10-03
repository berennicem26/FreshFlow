/**
 * tests/core/taxValuator.test.ts
 *
 * Unit tests for IRS Section 170(e)(3) valuation rules and edge cases.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6
 */

import { describe, it, expect } from 'vitest';
import { computeIrsDeduction } from '../../lib/core/taxValuator';

describe('taxValuator unit tests', () => {
  it('applies cost + 0.5 * (FMV - cost) when markup appreciation exists', () => {
    // 100 units @ $5 FMV = $500 total FMV. Cost total = $300.
    // Deduction = 300 + 0.5 * (500 - 300) = 400.
    const res = computeIrsDeduction(100, 5.0, 300);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.irsDeductionAmount).toBe(400);
      expect(res.value.irsFormReference).toBe('IRS Form 8283, Section B'); // $500 >= $500
    }
  });

  it('caps deduction at 2x cost basis when appreciation is high', () => {
    // 100 units @ $10 FMV = $1000 total FMV. Cost total = $200.
    // Uncapped = 200 + 0.5 * (1000 - 200) = 600.
    // 2x Cost Cap = 2 * 200 = 400.
    const res = computeIrsDeduction(100, 10.0, 200);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.irsDeductionAmount).toBe(400);
    }
  });

  it('sets deduction to costBasisTotal when FMV is at or below cost', () => {
    // 50 units @ $2.00 FMV = $100 total FMV. Cost total = $120.
    const res = computeIrsDeduction(50, 2.0, 120);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.irsDeductionAmount).toBe(120);
      expect(res.value.irsFormReference).toBe('IRS Form 8283, Section A'); // $100 < $500
    }
  });

  it('assigns Form 8283 Section A for donations strictly under $500 FMV', () => {
    const res = computeIrsDeduction(49, 10.0, 200); // 490 total FMV
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.irsFormReference).toBe('IRS Form 8283, Section A');
    }
  });

  it('assigns Form 8283 Section B for donations of $500 or more FMV', () => {
    const res = computeIrsDeduction(50, 10.0, 200); // 500 total FMV
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.irsFormReference).toBe('IRS Form 8283, Section B');
    }
  });

  it('rejects zero or negative donatedQuantityUnits', () => {
    const res = computeIrsDeduction(0, 5.0, 100);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('donatedQuantityUnits must be a positive integer');
    }
  });

  it('rejects negative costBasisTotal', () => {
    const res = computeIrsDeduction(10, 5.0, -50);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('costBasisTotal must be non-negative');
    }
  });
});
