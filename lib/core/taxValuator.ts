/**
 * lib/core/taxValuator.ts — Pure functional IRS Section 170(e)(3) valuation engine.
 *
 * Computes fair market value tax deduction amounts for inventory donated to
 * non-profit 501(c)(3) food banks, enforcing the statutory limits and form references.
 *
 * IRS §170(e)(3) rules:
 * - Deduction = Cost Basis + 0.5 * (Fair Market Value - Cost Basis)
 * - Capped at 2 * Cost Basis
 * - Floor: cannot be less than Cost Basis (when FMV <= Cost Basis)
 * - Reporting: Form 8283 Section A (< $500 FMV) vs Section B (>= $500 FMV)
 */

import type { DonationManifest } from '../types';

// ---------------------------------------------------------------------------
// Result type for tax valuator
// ---------------------------------------------------------------------------

export interface TaxComputation {
  readonly irsDeductionAmount: number;
  readonly totalFairMarketValue: number;
  readonly costBasisTotal: number;
  readonly irsFormReference: string;
}

export type TaxResult =
  | { ok: true; value: TaxComputation }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helper: Financial Rounding
// ---------------------------------------------------------------------------

export function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// computeIrsDeduction
// ---------------------------------------------------------------------------

/**
 * Computes the IRS Section 170(e)(3) deduction amount and form reference.
 *
 * @param donatedQuantityUnits   Number of physical units donated (must be positive integer)
 * @param fairMarketValuePerUnit Full retail/fair market value per unit (must be positive)
 * @param costBasisTotal         Total wholesale cost basis for the donated inventory
 */
export function computeIrsDeduction(
  donatedQuantityUnits: number,
  fairMarketValuePerUnit: number,
  costBasisTotal: number
): TaxResult {
  // --- Input validations (Requirement 7.6) ---
  if (!Number.isInteger(donatedQuantityUnits) || donatedQuantityUnits <= 0) {
    return {
      ok: false,
      error: 'donatedQuantityUnits must be a positive integer',
    };
  }

  if (fairMarketValuePerUnit <= 0) {
    return {
      ok: false,
      error: 'fairMarketValuePerUnit must be positive',
    };
  }

  if (costBasisTotal < 0) {
    return {
      ok: false,
      error: 'costBasisTotal must be non-negative',
    };
  }

  const cleanCostBasis = roundCurrency(costBasisTotal);
  const totalFairMarketValue = roundCurrency(fairMarketValuePerUnit * donatedQuantityUnits);

  // --- IRS Section 170(e)(3) Formula (Requirements 7.1, 7.2, 7.3, 7.5) ---
  let irsDeductionAmount: number;

  if (totalFairMarketValue <= cleanCostBasis) {
    // FMV dropped to or below cost -> deduction equals cost basis
    irsDeductionAmount = cleanCostBasis;
  } else {
    // Standard rule: Cost + half the markup
    const halfAppreciation = 0.5 * (totalFairMarketValue - cleanCostBasis);
    const uncappedDeduction = cleanCostBasis + halfAppreciation;
    // Statutory cap: maximum 2x cost basis
    irsDeductionAmount = Math.min(2 * cleanCostBasis, uncappedDeduction);
  }

  irsDeductionAmount = roundCurrency(irsDeductionAmount);

  // --- IRS Form Reference (Requirement 7.4) ---
  const irsFormReference =
    totalFairMarketValue < 500
      ? 'IRS Form 8283, Section A'
      : 'IRS Form 8283, Section B';

  return {
    ok: true,
    value: {
      irsDeductionAmount,
      totalFairMarketValue,
      costBasisTotal: cleanCostBasis,
      irsFormReference,
    },
  };
}
