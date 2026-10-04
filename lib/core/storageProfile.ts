/**
 * lib/core/storageProfile.ts — Maps outdoor weather to the temperature a product actually experiences.
 *
 * Pure functions, zero I/O.
 *
 * Why this exists: outdoor air temperature is NOT the temperature of milk in a cooler.
 *  - Refrigerated display cases hold 2–8°C regardless of room temperature. A heatwave
 *    only nudges them up slightly (more door openings, compressor strain).
 *  - Room-temperature shelves follow the store's indoor temperature, which air
 *    conditioning keeps well below outdoor peaks.
 */

import type { PerishableBatch, ProductCategory, StorageZone } from '../types';

/** Normal (reference) product temperature for each zone, in °C. */
export const ZONE_REFERENCE_C: Record<StorageZone, number> = {
  refrigerated: 4.0,
  ambient: 20.0,
};

/** Outdoor temperature above which heat starts loading the store, in °C. */
export const HEAT_LOAD_THRESHOLD_C = 20.0;

/** Cooler drift: °C of product warming per °C of outdoor heat above the threshold. */
export const COOLER_DRIFT_PER_C = 0.15;

/** Indoor drift: °C of shelf warming/cooling per °C of outdoor deviation (HVAC-dampened). */
export const INDOOR_DRIFT_PER_C = 0.4;

/** Indoor temperature bounds maintained by store HVAC, in °C. */
export const INDOOR_MIN_C = 16.0;
export const INDOOR_MAX_C = 30.0;

/** Default display zone by category when a batch does not declare one. */
const DEFAULT_ZONE: Record<ProductCategory, StorageZone> = {
  dairy: 'refrigerated',
  meat: 'refrigerated',
  prepared: 'refrigerated',
  produce: 'ambient',
  bakery: 'ambient',
};

export function resolveStorageZone(
  batch: Pick<PerishableBatch, 'category' | 'storageZone'>
): StorageZone {
  return batch.storageZone ?? DEFAULT_ZONE[batch.category] ?? 'refrigerated';
}

/**
 * Estimates the product temperature for a zone given the outdoor temperature.
 *
 *  refrigerated: 4°C + 0.15 × max(0, outdoor − 20)       e.g. 35°C outside → ~6.3°C
 *  ambient:      clamp(20 + 0.4 × (outdoor − 20), 16, 30)  e.g. 35°C outside → 26°C
 */
export function estimateProductTemperatureC(zone: StorageZone, outdoorC: number): number {
  if (zone === 'refrigerated') {
    return ZONE_REFERENCE_C.refrigerated + COOLER_DRIFT_PER_C * Math.max(0, outdoorC - HEAT_LOAD_THRESHOLD_C);
  }
  const indoor = ZONE_REFERENCE_C.ambient + INDOOR_DRIFT_PER_C * (outdoorC - HEAT_LOAD_THRESHOLD_C);
  return Math.min(INDOOR_MAX_C, Math.max(INDOOR_MIN_C, indoor));
}
