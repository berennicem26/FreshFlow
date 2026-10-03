/**
 * tests/arbitraries.ts — fast-check generators for FreshFlow domain models.
 *
 * Provides shared arbitraries for property-based testing across all core modules.
 */

import * as fc from 'fast-check';
import type {
  ProductCategory,
  TemperatureReading,
  PerishableBatch,
  ThermalDecayFactors,
} from '../lib/types';

// ---------------------------------------------------------------------------
// Sensor & Temperature Arbitraries
// ---------------------------------------------------------------------------

export const arbProductCategory: fc.Arbitrary<ProductCategory> = fc.constantFrom(
  'produce',
  'dairy',
  'meat',
  'bakery',
  'prepared'
);

/** Generates valid sensor temperature readings within [-30, 60] °C */
export const arbTemperatureReading: fc.Arbitrary<TemperatureReading> = fc.record({
  timestampIso: fc
    .integer({ min: 1735689600000, max: 1798761600000 })
    .map((ts) => new Date(ts).toISOString()),
  celsius: fc.double({ min: -30, max: 60, noNaN: true }),
});

/** Non-empty history of readings (up to 72 hours) */
export const arbTemperatureHistory: fc.Arbitrary<TemperatureReading[]> = fc.array(
  arbTemperatureReading,
  { minLength: 1, maxLength: 72 }
);

// ---------------------------------------------------------------------------
// Thermal Factor Arbitraries
// ---------------------------------------------------------------------------

/** Arrhenius path: q10Coefficient = 0 (sentinel), Ea in [10, 200] kJ/mol */
export const arbThermalFactorsArrhenius: fc.Arbitrary<
  Pick<ThermalDecayFactors, 'referenceTemperatureCelsius' | 'q10Coefficient' | 'activationEnergyKJ'>
> = fc.record({
  referenceTemperatureCelsius: fc.double({ min: 0, max: 10, noNaN: true }),
  q10Coefficient: fc.constant(0),
  activationEnergyKJ: fc.double({ min: 10, max: 200, noNaN: true }),
});

/** Q10 path: q10 strictly accelerating (> 1.0 up to 5.0), Ea fixed default */
export const arbThermalFactorsQ10: fc.Arbitrary<
  Pick<ThermalDecayFactors, 'referenceTemperatureCelsius' | 'q10Coefficient' | 'activationEnergyKJ'>
> = fc.record({
  referenceTemperatureCelsius: fc.double({ min: 0, max: 10, noNaN: true }),
  q10Coefficient: fc.double({ min: 1.05, max: 5.0, noNaN: true }),
  activationEnergyKJ: fc.constant(50),
});

// ---------------------------------------------------------------------------
// Perishable Batch Arbitrary
// ---------------------------------------------------------------------------

export const arbPerishableBatch: fc.Arbitrary<PerishableBatch> = fc
  .record({
    batchId: fc.uuid(),
    sku: fc.stringMatching(/^SKU-[A-Z0-9]{6}$/),
    productName: fc.constantFrom(
      'Organic Strawberries 1lb',
      'Whole Milk 1gal',
      'Atlantic Salmon Fillet 8oz',
      'Artisan Sourdough Loaf',
      'Greek Salad Bowl 12oz'
    ),
    category: arbProductCategory,
    storeId: fc.constantFrom('STORE-001', 'STORE-002', 'STORE-003'),
    nominalShelfLifeDays: fc.integer({ min: 1, max: 30 }),
    expiryOffsetDays: fc.double({ min: -5, max: 20, noNaN: true }),
    costBasisPerUnit: fc.double({ min: 0.5, max: 20, noNaN: true }),
    msrpMarkupFactor: fc.double({ min: 1.1, max: 3.0, noNaN: true }),
    quantityOnHand: fc.integer({ min: 1, max: 500 }),
    temperatureHistory: arbTemperatureHistory,
    dailySalesVelocity: fc.double({ min: 0, max: 50, noNaN: true }),
  })
  .map((raw) => {
    const baseDate = new Date('2026-10-03T12:00:00Z');
    const expiryDate = new Date(baseDate.getTime() + raw.expiryOffsetDays * 86_400_000);
    const costBasis = Math.round(raw.costBasisPerUnit * 100) / 100;
    const msrp = Math.round(costBasis * raw.msrpMarkupFactor * 100) / 100;

    return {
      batchId: raw.batchId,
      sku: raw.sku,
      productName: raw.productName,
      category: raw.category,
      storeId: raw.storeId,
      nominalShelfLifeDays: raw.nominalShelfLifeDays,
      expiryDateIso: expiryDate.toISOString(),
      costBasisPerUnit: costBasis,
      msrpPerUnit: Math.max(costBasis + 0.5, msrp),
      quantityOnHand: raw.quantityOnHand,
      temperatureHistory: raw.temperatureHistory,
      dailySalesVelocity: raw.dailySalesVelocity,
      createdAt: baseDate.toISOString(),
    };
  });
