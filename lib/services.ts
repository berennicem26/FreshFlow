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
  const now = new Date('2026-10-03T12:00:00Z');

  const add = (batch: PerishableBatch) => batches.set(batch.batchId, batch);

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0001',
    sku: 'SKU-BERRY-01',
    productName: 'Organic Strawberries 1lb',
    category: 'produce',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 5,
    expiryDateIso: new Date(now.getTime() + 1.2 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.2,
    msrpPerUnit: 4.99,
    quantityOnHand: 45,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 24.5 }],
    dailySalesVelocity: 12,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0002',
    sku: 'SKU-SALMON-02',
    productName: 'Fresh Atlantic Salmon Fillet 8oz',
    category: 'meat',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 3,
    expiryDateIso: new Date(now.getTime() + 0.8 * 86_400_000).toISOString(),
    costBasisPerUnit: 5.5,
    msrpPerUnit: 11.99,
    quantityOnHand: 18,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 4.0 }],
    dailySalesVelocity: 8,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0003',
    sku: 'SKU-SALAD-03',
    productName: 'Greek Salad Bowl with Feta 12oz',
    category: 'prepared',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 4,
    expiryDateIso: new Date(now.getTime() + 0.35 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.9,
    msrpPerUnit: 6.99,
    quantityOnHand: 30,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 21.0 }],
    dailySalesVelocity: 5,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0004',
    sku: 'SKU-MILK-04',
    productName: 'Organic Whole Milk 1gal',
    category: 'dairy',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 10,
    expiryDateIso: new Date(now.getTime() + 2.5 * 86_400_000).toISOString(),
    costBasisPerUnit: 2.1,
    msrpPerUnit: 4.49,
    quantityOnHand: 55,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 3.5 }],
    dailySalesVelocity: 15,
    createdAt: now.toISOString(),
  });

  add({
    batchId: '01918a20-8e3b-7a11-8a90-3a5e8f1b0005',
    sku: 'SKU-BREAD-05',
    productName: 'Artisan Sourdough Loaf 24oz',
    category: 'bakery',
    storeId: 'STORE-LA-01',
    nominalShelfLifeDays: 4,
    expiryDateIso: new Date(now.getTime() + 1.8 * 86_400_000).toISOString(),
    costBasisPerUnit: 1.8,
    msrpPerUnit: 5.49,
    quantityOnHand: 22,
    temperatureHistory: [{ timestampIso: now.toISOString(), celsius: 20.0 }],
    dailySalesVelocity: 9,
    createdAt: now.toISOString(),
  });

  return batches;
}

export function getBatchStore(): Map<string, PerishableBatch> {
  if (!global.__freshflow_batches) {
    global.__freshflow_batches = getInitialBatches();
  }
  return global.__freshflow_batches;
}
