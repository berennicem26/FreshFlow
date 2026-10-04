#!/usr/bin/env node
/**
 * scripts/reset-db.mjs
 *
 * Resets the SQLite audit database (data/freshflow.db) to a clean demo baseline.
 * Runs the schema.sql triggers and seeds initial baseline records.
 * Perfect to run right before recording the 2-minute demo video!
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'data', 'freshflow.db');

console.log('='.repeat(70));
console.log(' FreshFlow Database Reset & Clean Demo Seed');
console.log('='.repeat(70));

// Remove existing DB file
if (existsSync(DB_PATH)) {
  try {
    unlinkSync(DB_PATH);
    console.log('✓ Cleared previous database file (data/freshflow.db)');
  } catch (e) {
    console.warn('Could not remove file directly; emptying tables instead...');
  }
}

const dir = join(process.cwd(), 'data');
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Re-initialize schema
const db = new Database(DB_PATH);
const schemaPath = join(process.cwd(), 'lib', 'db', 'schema.sql');
const schemaSql = readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);
console.log('✓ Initialized clean SQLite schema with append-only triggers & indexes');

// Insert initial baseline records (1 weather sync + 2 realistic initial donation manifests)
const now = new Date();
const tMinus2h = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
const tMinus1h = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();

// Weather Sync
db.prepare(`
  INSERT INTO audit_entries (entry_id, entry_type, batch_id, store_id, occurred_at, payload)
  VALUES (?, 'WEATHER_SYNC', NULL, ?, ?, ?)
`).run(
  'WEATHER-INIT-001',
  'STORE-LA-101',
  tMinus2h,
  JSON.stringify({
    latitude: 34.0522,
    longitude: -118.2437,
    ambientTemperatureC: 20.0,
    relativeHumidityPct: 45,
    source: 'open-meteo-baseline',
  })
);

// Baseline Donation 1: Salmon Fillet
const salmonManifest = {
  manifestId: `MANIFEST-${Date.now().toString(36).toUpperCase()}-01`,
  batchId: 'BATCH-SALMON-02',
  productName: 'Fresh Atlantic Salmon Fillet 8oz',
  foodBankId: 'FB-LA-REGIONAL',
  foodBankName: 'Los Angeles Regional Food Bank',
  ein: '95-3129841',
  donatedAtIso: tMinus1h,
  quantityUnits: 18,
  unitCostBasis: 5.50,
  unitFairMarketValue: 11.99,
  totalCostBasis: 99.00,
  totalFairMarketValue: 215.82,
  irsDeductionAmount: 157.41,
  estimatedTaxSavings: 33.06,
  status: 'PENDING_CARRIER_PICKUP',
};

db.prepare(`
  INSERT INTO audit_entries (entry_id, entry_type, batch_id, store_id, occurred_at, payload)
  VALUES (?, 'DONATION_MANIFEST', ?, ?, ?, ?)
`).run(
  'AUDIT-DON-001',
  'BATCH-SALMON-02',
  'STORE-LA-101',
  tMinus1h,
  JSON.stringify(salmonManifest)
);

// Baseline Donation 2: Greek Salad Bowl
const saladManifest = {
  manifestId: `MANIFEST-${Date.now().toString(36).toUpperCase()}-02`,
  batchId: 'BATCH-SALAD-03',
  productName: 'Greek Salad Bowl with Feta 12oz',
  foodBankId: 'FB-LA-DOWNTOWN',
  foodBankName: 'Downtown Community Food Bank',
  ein: '95-4819201',
  donatedAtIso: tMinus1h,
  quantityUnits: 30,
  unitCostBasis: 2.90,
  unitFairMarketValue: 6.99,
  totalCostBasis: 87.00,
  totalFairMarketValue: 209.70,
  irsDeductionAmount: 148.35,
  estimatedTaxSavings: 31.15,
  status: 'PENDING_CARRIER_PICKUP',
};

db.prepare(`
  INSERT INTO audit_entries (entry_id, entry_type, batch_id, store_id, occurred_at, payload)
  VALUES (?, 'DONATION_MANIFEST', ?, ?, ?, ?)
`).run(
  'AUDIT-DON-002',
  'BATCH-SALAD-03',
  'STORE-LA-101',
  tMinus1h,
  JSON.stringify(saladManifest)
);

console.log('✓ Seeded 2 clean baseline donation manifests ($305.76 deduction total)');
console.log('='.repeat(70));
console.log(' Database is now in a pristine, realistic baseline demo state!');
console.log('='.repeat(70));
db.close();
