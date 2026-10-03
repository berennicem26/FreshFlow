/**
 * lib/core/donationRouter.ts — Pure functional donation routing and manifest generator.
 *
 * Evaluates donation eligibility for perishable batches near expiry, selects the
 * nearest active 501(c)(3) food bank partner using great-circle Haversine distance,
 * and produces IRS-compliant donation manifests.
 *
 * Zero I/O — pure functions only.
 */

import type { DonationManifest, PerishableBatch } from '../types';
import { computeIrsDeduction } from './taxValuator';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface FoodBank {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly isActive: boolean;
}

export type DonationResult =
  | { ok: true; value: DonationManifest }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Haversine Distance (Great-Circle)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

/**
 * Computes great-circle distance between two geographic coordinates in kilometers.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// ---------------------------------------------------------------------------
// shouldDonate
// ---------------------------------------------------------------------------

/**
 * Determines whether a batch is eligible for emergency donation routing.
 *
 * Rules (Requirements 6.1, 6.2, 6.6):
 * - Effective DTE < 0.5 days: ALWAYS donate immediately (spoilage threshold).
 * - Effective DTE <= 1.0 day AND sellThroughProbability < 0.05: donate (sell-through impossible).
 * - Otherwise: DO NOT donate (prevent premature donation).
 */
export function shouldDonate(
  effectiveDte: number,
  sellThroughProbability: number
): boolean {
  if (effectiveDte < 0.5) {
    return true;
  }
  if (effectiveDte <= 1.0 && sellThroughProbability < 0.05) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// selectNearestFoodBank
// ---------------------------------------------------------------------------

/**
 * Finds the closest active food bank partner to the store location.
 */
export function selectNearestFoodBank(
  storeLat: number,
  storeLon: number,
  foodBanks: FoodBank[]
): FoodBank | null {
  const activeBanks = foodBanks.filter((fb) => fb.isActive);
  if (activeBanks.length === 0) {
    return null;
  }

  let nearest = activeBanks[0];
  let minDistance = calculateHaversineDistanceKm(
    storeLat,
    storeLon,
    nearest.latitude,
    nearest.longitude
  );

  for (let i = 1; i < activeBanks.length; i++) {
    const candidate = activeBanks[i];
    const dist = calculateHaversineDistanceKm(
      storeLat,
      storeLon,
      candidate.latitude,
      candidate.longitude
    );
    if (dist < minDistance) {
      minDistance = dist;
      nearest = candidate;
    }
  }

  return nearest;
}

// ---------------------------------------------------------------------------
// buildDonationManifest
// ---------------------------------------------------------------------------

/**
 * Constructs an IRS-compliant DonationManifest for a perishable batch.
 */
export function buildDonationManifest(
  batch: PerishableBatch,
  effectiveDte: number,
  sellThroughProbability: number,
  storeCoords: { latitude: number; longitude: number },
  foodBanks: FoodBank[],
  manifestId?: string,
  generatedAtIso?: string
): DonationResult {
  if (batch.quantityOnHand <= 0) {
    return { ok: false, error: 'batch has no quantity available for donation' };
  }

  if (!shouldDonate(effectiveDte, sellThroughProbability)) {
    return {
      ok: false,
      error: 'batch does not meet donation eligibility criteria',
    };
  }

  const recipient = selectNearestFoodBank(
    storeCoords.latitude,
    storeCoords.longitude,
    foodBanks
  );

  if (!recipient) {
    return {
      ok: false,
      error: 'no active recipient is configured',
    };
  }

  // Precedence rule (Requirement 6.3):
  // When effectiveDte < 0.5, effective_dte_below_threshold takes precedence
  const triggerReason =
    effectiveDte < 0.5
      ? 'effective_dte_below_threshold'
      : 'sell_through_impossible';

  const costBasisTotal = Math.round(batch.costBasisPerUnit * batch.quantityOnHand * 100) / 100;
  const taxRes = computeIrsDeduction(
    batch.quantityOnHand,
    batch.msrpPerUnit,
    costBasisTotal
  );

  if (!taxRes.ok) {
    return { ok: false, error: taxRes.error };
  }

  const manifest: DonationManifest = {
    manifestId: manifestId ?? `MANIFEST-${Date.now()}`,
    batchId: batch.batchId,
    generatedAtIso: generatedAtIso ?? new Date().toISOString(),
    recipientFoodBankId: recipient.id,
    recipientFoodBankName: recipient.name,
    donatedQuantityUnits: batch.quantityOnHand,
    fairMarketValuePerUnit: batch.msrpPerUnit,
    totalFairMarketValue: taxRes.value.totalFairMarketValue,
    costBasisTotal,
    irsDeductionAmount: taxRes.value.irsDeductionAmount,
    irsFormReference: taxRes.value.irsFormReference,
    triggerReason,
  };

  return { ok: true, value: manifest };
}
