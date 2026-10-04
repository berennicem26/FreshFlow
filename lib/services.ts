/**
 * lib/services.ts — Server-side singletons for AuditLedger, WeatherSync, and batch store.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AuditLedger } from './db/auditLedger';
import { WeatherSync } from './shell/weatherSync';
import type { FoodBank } from './core/donationRouter';
import type { PerishableBatch } from './types';

// Ensure data/ directory exists
const DATA_DIR = join(process.cwd(), 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = join(DATA_DIR, 'freshflow.db');

// Global singletons for Next.js App Router
declare global {
  // eslint-disable-next-line no-var
  var __freshflow_ledger: AuditLedger | undefined;
  // eslint-disable-next-line no-var
  var __freshflow_weather_sync: WeatherSync | undefined;
  // eslint-disable-next-line no-var
  var __freshflow_batches: Map<string, PerishableBatch> | undefined;
}

export function getAuditLedger(): AuditLedger {
  if (!global.__freshflow_ledger) {
    global.__freshflow_ledger = new AuditLedger({ dbPath: DB_PATH });
  }
  return global.__freshflow_ledger;
}

export function getWeatherSync(): WeatherSync {
  if (!global.__freshflow_weather_sync) {
    global.__freshflow_weather_sync = new WeatherSync(getAuditLedger());
  }
  return global.__freshflow_weather_sync;
}

// Registered 501(c)(3) Food Bank Partners
export const REGISTERED_FOOD_BANKS: FoodBank[] = [
  {
    id: 'FB-LA-DOWNTOWN',
    name: 'Downtown Community Food Bank',
    latitude: 34.0435,
    longitude: -118.2431,
    isActive: true,
  },
  {
    id: 'FB-LA-REGIONAL',
    name: 'Los Angeles Regional Food Bank',
    latitude: 34.0041,
    longitude: -118.2323,
    isActive: true,
  },
  {
    id: 'FB-LA-WESTSIDE',
    name: 'Westside Food Bank',
    latitude: 34.0259,
    longitude: -118.4735,
    isActive: true,
  },
];

// Seeded batches
function getInitialBatches(): Map<string, PerishableBatch> {
  const batches = new Map<string, PerishableBatch>();
  const now = new Date();

  const add = (batch: PerishableBatch) => batches.set(batch.batchId, batch);

  // 0. Avocados (produce, fresh lot):
  // At 20°C: decay factor 3.53x, DTE_eff = 14.0 / 3.53 = 3.96d -> NONE (Full Price 0%, $5.99)
  // At 32°C: decay factor 9.09x, DTE_eff = 14.0 / 9.09 = 1.54d -> Tier 2 (-35%, $3.89)
  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0000',
    sku: 'SKU-AVOCADO-00',
    productName: 'Fresh Hass Avocados 4pk',
    category: 'produce',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 14,
    expiryDateIso: new Date(now.getTime() + 14.0 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.4,
    msrpPerUnit: 5.99,
    quantityOnHand: 40,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 20.0 }],
    dailySalesVelocity: 10,
    createdAt: now.toISOString(),
  });

  // 1. Honeycrisp Apples (produce, early-stage clearance):
  // At 20°C: decay factor 3.53x, DTE_eff = 8.5 / 3.53 = 2.41d, sell-through 0.48 -> Tier 1 (-15%, $4.24)
  // At 32°C: decay factor 9.09x, DTE_eff = 8.5 / 9.09 = 0.93d -> Tier 3 (-50%, $2.49)
  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0006',
    sku: 'SKU-APPLE-06',
    productName: 'Crisp Honeycrisp Apples 3lb',
    category: 'produce',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 10,
    expiryDateIso: new Date(now.getTime() + 8.5 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.1,
    msrpPerUnit: 4.99,
    quantityOnHand: 40,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 20.0 }],
    dailySalesVelocity: 8,
    createdAt: now.toISOString(),
  });

  // 2. Strawberries (produce, Q10 = 2.2):
  // At 20°C: decay factor 3.53x, DTE_eff = 4.2 / 3.53 = 1.19d -> Tier 2 (-35%, $3.24)
  // At 32°C: decay factor 9.09x, DTE_eff = 4.2 / 9.09 = 0.46d -> Donate (Food Bank)
  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0001',
    sku: 'SKU-BERRY-01',
    productName: 'Organic Strawberries 1lb',
    category: 'produce',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 5,
    expiryDateIso: new Date(now.getTime() + 4.2 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.2,
    msrpPerUnit: 4.99,
    quantityOnHand: 45,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 20.0 }],
    dailySalesVelocity: 12,
    createdAt: now.toISOString(),
  });

  // 2. Salmon (meat, Q10 = 2.8):
  // At 20°C: decay factor 5.17x, DTE_eff = 1.5 / 5.17 = 0.29d -> Donate (Food Bank)
  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0002',
    sku: 'SKU-SALMON-02',
    productName: 'Fresh Atlantic Salmon Fillet 8oz',
    category: 'meat',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 3,
    expiryDateIso: new Date(now.getTime() + 1.5 * 86_400_000).toISOString(),
    costBasisPerUnit: 5.5,
    msrpPerUnit: 11.99,
    quantityOnHand: 18,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 4.0 }],
    dailySalesVelocity: 8,
    createdAt: now.toISOString(),
  });

  // 3. Salad (prepared, Q10 = 2.4):
  // At 20°C: decay factor 4.07x, DTE_eff = 1.4 / 4.07 = 0.34d -> Donate (Food Bank)
  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0003',
    sku: 'SKU-SALAD-03',
    productName: 'Greek Salad Bowl with Feta 12oz',
    category: 'prepared',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 4,
    expiryDateIso: new Date(now.getTime() + 1.4 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.9,
    msrpPerUnit: 6.99,
    quantityOnHand: 30,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 20.0 }],
    dailySalesVelocity: 5,
    createdAt: now.toISOString(),
  });

  // 4. Whole Milk (dairy, Q10 = 2.5):
  // At 20°C: decay factor 4.33x, DTE_eff = 4.6 / 4.33 = 1.06d -> Tier 2 (-35%, $2.92)
  // At 32°C: decay factor 12.96x, DTE_eff = 4.6 / 12.96 = 0.35d -> Donate (Food Bank)
  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0004',
    sku: 'SKU-MILK-04',
    productName: 'Organic Whole Milk 1gal',
    category: 'dairy',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 10,
    expiryDateIso: new Date(now.getTime() + 4.6 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.1,
    msrpPerUnit: 4.49,
    quantityOnHand: 55,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 3.5 }],
    dailySalesVelocity: 15,
    createdAt: now.toISOString(),
  });

  // 5. Artisan Sourdough (bakery, Q10 = 2.0):
  // At 20°C: decay factor 3.03x, DTE_eff = 2.6 / 3.03 = 0.86d -> Tier 3 (-50%, $2.75)
  // At 32°C: decay factor 6.96x, DTE_eff = 2.6 / 6.96 = 0.37d -> Donate (Food Bank)
  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0005',
    sku: 'SKU-BREAD-05',
    productName: 'Artisan Sourdough Loaf 24oz',
    category: 'bakery',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 4,
    expiryDateIso: new Date(now.getTime() + 2.6 * 86_400_000).toISOString(),
    costBasisPerUnit: 1.8,
    msrpPerUnit: 5.49,
    quantityOnHand: 22,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 20.0 }],
    dailySalesVelocity: 9,
    createdAt: now.toISOString(),
  });

  return batches;
}

export function resetBatchStore(): Map<string, PerishableBatch> {
  global.__freshflow_batches = getInitialBatches();
  return global.__freshflow_batches;
}

export function getBatchStore(): Map<string, PerishableBatch> {
  if (!global.__freshflow_batches) {
    global.__freshflow_batches = getInitialBatches();
  } else {
    // If batches have expired or are past their nominal shelf life, auto-refresh
    const first = global.__freshflow_batches.values().next().value;
    if (first && Date.parse(first.expiryDateIso) < Date.now()) {
      global.__freshflow_batches = getInitialBatches();
    }
  }
  return global.__freshflow_batches;
}
