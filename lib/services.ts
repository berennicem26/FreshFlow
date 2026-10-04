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
//
// "Days left" values are realistic for a supermarket floor and are chosen so that at a
// normal 20°C day every stage of the lifecycle is visible, and a heatwave visibly
// pushes each batch one stage forward:
//
//   Product (zone)              days  20°C outdoor          32°C outdoor
//   Avocados (shelf)            7.0   Full price            Tier 1 (-15%)
//   Honeycrisp Apples (shelf)   4.8   Tier 1 (-15%)         Tier 2 (-35%)
//   Strawberries (cooler)       3.3   Tier 2 (-35%)         Tier 3 (-50%)
//   Whole Milk (cooler)         4.6   Full price (sells fast) Tier 2 (-35%)
//   Sourdough (shelf)           2.6   Tier 3 (-50%)         Donate
//   Salmon (cooler)             2.6   Donate (slow seller)  Donate
//   Greek Salad (cooler)        1.8   Donate                Donate
//
// Coolers hold ~4°C, so a heatwave affects them modestly (~1.15–1.2× faster);
// room-temperature shelves follow the store's indoor temperature (~1.4–1.5× faster).
function getInitialBatches(): Map<string, PerishableBatch> {
  const batches = new Map<string, PerishableBatch>();
  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
  const cooler = [{ timestampIso: now.toISOString(), celsius: 4.0 }];
  const shelf = [{ timestampIso: now.toISOString(), celsius: 20.0 }];

  const add = (batch: PerishableBatch) => batches.set(batch.batchId, batch);

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0000',
    sku: 'SKU-AVOCADO-00',
    productName: 'Fresh Hass Avocados 4pk',
    category: 'produce',
    storageZone: 'ambient',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 10,
    expiryDateIso: inDays(7.0),
    costBasisPerUnit: 2.4,
    msrpPerUnit: 5.99,
    quantityOnHand: 48,
    temperatureHistory: shelf,
    dailySalesVelocity: 6,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0006',
    sku: 'SKU-APPLE-06',
    productName: 'Crisp Honeycrisp Apples 3lb',
    category: 'produce',
    storageZone: 'ambient',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 14,
    expiryDateIso: inDays(4.8),
    costBasisPerUnit: 2.1,
    msrpPerUnit: 4.99,
    quantityOnHand: 60,
    temperatureHistory: shelf,
    dailySalesVelocity: 8,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0001',
    sku: 'SKU-BERRY-01',
    productName: 'Organic Strawberries 1lb',
    category: 'produce',
    storageZone: 'refrigerated',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 7,
    expiryDateIso: inDays(3.3),
    costBasisPerUnit: 2.2,
    msrpPerUnit: 4.99,
    quantityOnHand: 36,
    temperatureHistory: cooler,
    dailySalesVelocity: 12,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0002',
    sku: 'SKU-SALMON-02',
    productName: 'Fresh Atlantic Salmon Fillet 8oz',
    category: 'meat',
    storageZone: 'refrigerated',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 5,
    expiryDateIso: inDays(2.6),
    costBasisPerUnit: 5.5,
    msrpPerUnit: 11.99,
    quantityOnHand: 18,
    temperatureHistory: cooler,
    dailySalesVelocity: 2,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0003',
    sku: 'SKU-SALAD-03',
    productName: 'Greek Salad Bowl with Feta 12oz',
    category: 'prepared',
    storageZone: 'refrigerated',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 5,
    expiryDateIso: inDays(1.8),
    costBasisPerUnit: 2.9,
    msrpPerUnit: 6.99,
    quantityOnHand: 30,
    temperatureHistory: cooler,
    dailySalesVelocity: 5,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0004',
    sku: 'SKU-MILK-04',
    productName: 'Organic Whole Milk 1gal',
    category: 'dairy',
    storageZone: 'refrigerated',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 14,
    expiryDateIso: inDays(4.6),
    costBasisPerUnit: 2.1,
    msrpPerUnit: 4.49,
    quantityOnHand: 55,
    temperatureHistory: cooler,
    dailySalesVelocity: 15,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0005',
    sku: 'SKU-BREAD-05',
    productName: 'Artisan Sourdough Loaf 24oz',
    category: 'bakery',
    storageZone: 'ambient',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 4,
    expiryDateIso: inDays(2.6),
    costBasisPerUnit: 1.8,
    msrpPerUnit: 5.49,
    quantityOnHand: 22,
    temperatureHistory: shelf,
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
