/**
 * tests/core/donationRouter.test.ts
 *
 * Unit tests for donation routing triggers, partner selection, and manifest building.
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { describe, it, expect } from 'vitest';
import {
  shouldDonate,
  selectNearestFoodBank,
  buildDonationManifest,
  calculateHaversineDistanceKm,
  type FoodBank,
} from '../../lib/core/donationRouter';
import type { PerishableBatch } from '../../lib/types';

describe('donationRouter unit tests', () => {
  const storeCoords = { latitude: 34.0522, longitude: -118.2437 }; // Los Angeles

  const mockFoodBanks: FoodBank[] = [
    {
      id: 'FB-NEAR',
      name: 'Downtown Community Food Bank',
      latitude: 34.0407,
      longitude: -118.2468, // ~1.3 km away
      isActive: true,
    },
    {
      id: 'FB-FAR',
      name: 'Valley Regional Food Pantry',
      latitude: 34.1808,
      longitude: -118.449, // ~25 km away
      isActive: true,
    },
    {
      id: 'FB-INACTIVE',
      name: 'Closed Food Shelter',
      latitude: 34.053,
      longitude: -118.244, // Very close but inactive
      isActive: false,
    },
  ];

  const testBatch: PerishableBatch = {
    batchId: 'BATCH-DONATE-01',
    sku: 'SKU-BERRY-01',
    productName: 'Organic Strawberries',
    category: 'produce',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 5,
    expiryDateIso: '2026-10-04T12:00:00Z',
    costBasisPerUnit: 2.0,
    msrpPerUnit: 5.0,
    quantityOnHand: 40,
    temperatureHistory: [{ timestampIso: '2026-10-03T00:00:00Z', celsius: 18 }],
    dailySalesVelocity: 5,
    createdAt: '2026-10-01T00:00:00Z',
  };

  it('selects the nearest active food bank using Haversine distance, ignoring inactive partners', () => {
    const nearest = selectNearestFoodBank(
      storeCoords.latitude,
      storeCoords.longitude,
      mockFoodBanks
    );
    expect(nearest).not.toBeNull();
    expect(nearest!.id).toBe('FB-NEAR');
  });

  it('returns null when no active food banks exist', () => {
    const inactiveOnly = mockFoodBanks.map((fb) => ({ ...fb, isActive: false }));
    const nearest = selectNearestFoodBank(
      storeCoords.latitude,
      storeCoords.longitude,
      inactiveOnly
    );
    expect(nearest).toBeNull();
  });

  it('correctly calculates Haversine distance between coordinates', () => {
    const dist = calculateHaversineDistanceKm(
      storeCoords.latitude,
      storeCoords.longitude,
      mockFoodBanks[0].latitude,
      mockFoodBanks[0].longitude
    );
    expect(dist).toBeGreaterThan(1.0);
    expect(dist).toBeLessThan(2.0);
  });

  it('triggers donation when 1.0 <= effectiveDte <= 2.0 (final window with food bank buffer)', () => {
    expect(shouldDonate(1.5, 0.9)).toBe(true);
  });

  it('triggers early donation when effectiveDte <= 3.0 AND sellThroughProbability < 0.5', () => {
    expect(shouldDonate(2.8, 0.3)).toBe(true);
  });

  it('does NOT trigger donation when effectiveDte > 2.0 and stock is still selling', () => {
    expect(shouldDonate(2.8, 0.8)).toBe(false);
    expect(shouldDonate(4.0, 0.1)).toBe(false);
  });

  it('does NOT donate below 1.0 day — too late for pickup and distribution', () => {
    expect(shouldDonate(0.6, 0.01)).toBe(false);
  });

  it('prioritizes effective_dte_below_threshold over sell_through_impossible inside the final window', () => {
    // effectiveDte = 1.5 (<= 2.0) AND stp = 0.01 (< 0.5)
    const res = buildDonationManifest(
      testBatch,
      1.5,
      0.01,
      storeCoords,
      mockFoodBanks
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.triggerReason).toBe('effective_dte_below_threshold');
      expect(res.value.donatedQuantityUnits).toBe(40);
      expect(res.value.recipientFoodBankId).toBe('FB-NEAR');
      expect(res.value.totalFairMarketValue).toBe(200); // 40 * $5
      expect(res.value.costBasisTotal).toBe(80); // 40 * $2
      // Deduction: 80 + 0.5 * (200 - 80) = 140
      expect(res.value.irsDeductionAmount).toBe(140);
      expect(res.value.irsFormReference).toBe('IRS Form 8283, Section A');
    }
  });

  it('uses sell_through_impossible for early donations (2.0 < DTE <= 3.0)', () => {
    const res = buildDonationManifest(testBatch, 2.6, 0.2, storeCoords, mockFoodBanks);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.triggerReason).toBe('sell_through_impossible');
    }
  });

  it('fails with descriptive error when no active recipient is available', () => {
    const res = buildDonationManifest(testBatch, 1.5, 0.5, storeCoords, []);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('no active recipient is configured');
    }
  });
});
