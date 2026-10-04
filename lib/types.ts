/**
 * lib/types.ts — Single source of truth for all FreshFlow shared interfaces and types.
 *
 * Every module in lib/core/, lib/db/, lib/shell/, and app/api/ imports from here.
 * No I/O, no logic — pure TypeScript type definitions only.
 */

// ---------------------------------------------------------------------------
// Result<T> — Canonical discriminated union for all Functional Core returns
// ---------------------------------------------------------------------------

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Domain primitives
// ---------------------------------------------------------------------------

export type ProductCategory = 'produce' | 'dairy' | 'meat' | 'bakery' | 'prepared';

/**
 * Markdown tiers in ascending urgency.
 * - DONATION: routed to a food bank while enough shelf-life remains for pickup & distribution.
 * - PULL: too close to its date for shoppers or food banks; removed from sale.
 */
export type MarkdownTier = 'NONE' | 'TIER_1' | 'TIER_2' | 'TIER_3' | 'DONATION' | 'PULL';

/**
 * Where a batch is physically displayed in the store.
 * - refrigerated: chilled display case (held near 4°C regardless of room temperature)
 * - ambient: room-temperature shelf (follows the store's indoor temperature)
 */
export type StorageZone = 'refrigerated' | 'ambient';

// ---------------------------------------------------------------------------
// Core data models
// ---------------------------------------------------------------------------

export interface TemperatureReading {
  readonly timestampIso: string;
  readonly celsius: number;
}

export interface PerishableBatch {
  readonly batchId: string;
  readonly sku: string;
  readonly productName: string;
  readonly category: ProductCategory;
  /** Optional display zone; defaults by category when absent (see lib/core/storageProfile.ts). */
  readonly storageZone?: StorageZone;
  readonly storeId: string;
  readonly nominalShelfLifeDays: number;
  readonly expiryDateIso: string;
  readonly costBasisPerUnit: number;
  readonly msrpPerUnit: number;
  readonly quantityOnHand: number;
  /** Product-level temperature readings (cooler / shelf sensors), not outdoor weather. */
  readonly temperatureHistory: TemperatureReading[];
  readonly dailySalesVelocity: number;
  readonly createdAt: string;
}

export interface ThermalDecayFactors {
  readonly referenceTemperatureCelsius: number;
  readonly q10Coefficient: number;
  readonly activationEnergyKJ: number;
  readonly computedDecayFactor: number;
  readonly effectiveDteReductionDays: number;
}

export interface PricingDecision {
  readonly batchId: string;
  readonly evaluatedAtIso: string;
  readonly effectiveDte: number;
  readonly sellThroughProbability: number;
  readonly tier: MarkdownTier;
  readonly discountRate: number;
  readonly computedPricePerUnit: number | null;
  readonly salvageFloorPerUnit: number;
  readonly msrpPerUnit: number;
  readonly boundednessVerified: boolean;
  readonly rationale: string;
}

export interface DonationManifest {
  readonly manifestId: string;
  readonly batchId: string;
  readonly generatedAtIso: string;
  readonly recipientFoodBankId: string;
  readonly recipientFoodBankName: string;
  readonly donatedQuantityUnits: number;
  readonly fairMarketValuePerUnit: number;
  readonly totalFairMarketValue: number;
  readonly costBasisTotal: number;
  readonly irsDeductionAmount: number;
  readonly irsFormReference: string;
  readonly triggerReason: 'effective_dte_below_threshold' | 'sell_through_impossible';
}

export interface WeatherSyncRecord {
  readonly syncId: string;
  readonly storeId: string;
  readonly fetchedAtIso: string;
  readonly locationLatitude: number;
  readonly locationLongitude: number;
  readonly readings: TemperatureReading[];
  readonly forecastHorizonHours: number;
}

export interface AuditEntry {
  readonly entryId: string;
  readonly entryType:
    | 'PRICING_DECISION'
    | 'DONATION_MANIFEST'
    | 'WEATHER_SYNC'
    | 'PRICE_INVARIANT_VIOLATION';
  readonly batchId: string | null;
  readonly storeId: string;
  readonly occurredAtIso: string;
  readonly payload: PricingDecision | DonationManifest | WeatherSyncRecord | string;
}
