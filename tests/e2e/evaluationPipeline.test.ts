/**
 * tests/e2e/evaluationPipeline.test.ts
 *
 * End-to-end integration and smoke tests for the evaluation pipeline.
 * Validates: Requirements 9.1, 9.2, 10.1, 10.8 (Task 6.8)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { AuditLedger } from '../../lib/db/auditLedger';
import { computeThermalDecayFactor } from '../../lib/core/thermalCalculator';
import { computeEffectiveDte } from '../../lib/core/shelfLifeCalculator';
import { buildPricingDecision } from '../../lib/core/pricingEngine';
import { buildDonationManifest, type FoodBank } from '../../lib/core/donationRouter';
import type { PerishableBatch } from '../../lib/types';

describe('Evaluation Pipeline E2E Smoke Tests', () => {
  const testDbPath = join(__dirname, 'test-e2e.db');
  let ledger: AuditLedger;

  const mockFoodBanks: FoodBank[] = [
    {
      id: 'FB-01',
      name: 'Central Food Bank',
      latitude: 34.05,
      longitude: -118.25,
      isActive: true,
    },
  ];

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    ledger = new AuditLedger({ dbPath: testDbPath });
  });

  afterEach(() => {
    ledger.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('runs full evaluation cycle: batch -> thermal -> shelf-life -> pricing -> audit log', async () => {
    const batchId = 'BATCH-E2E-01';
    const batch: PerishableBatch = {
      batchId,
      sku: 'SKU-STRAWBERRY-01',
      productName: 'Organic Strawberries',
      category: 'produce',
      storeId: 'STORE-001',
      nominalShelfLifeDays: 5,
      expiryDateIso: '2026-10-06T12:00:00Z',
      costBasisPerUnit: 2.0,
      msrpPerUnit: 5.0,
      quantityOnHand: 50,
      temperatureHistory: [{ timestampIso: '2026-10-03T00:00:00Z', celsius: 24 }],
      dailySalesVelocity: 15,
      createdAt: '2026-10-03T00:00:00Z',
    };

    // 1. Thermal
    const thermalRes = computeThermalDecayFactor(batch.temperatureHistory, {
      referenceTemperatureCelsius: 4,
      q10Coefficient: 2.0,
      activationEnergyKJ: 50,
    });
    expect(thermalRes.ok).toBe(true);
    const decayFactor = thermalRes.ok ? thermalRes.value.computedDecayFactor : 1.0;

    // 2. Shelf-life
    const nowIso = '2026-10-03T12:00:00Z'; // 3 nominal days left
    const shelfLifeRes = computeEffectiveDte(batch, decayFactor, nowIso);
    expect(shelfLifeRes.ok).toBe(true);
    const { effectiveDte, sellThroughProbability } = shelfLifeRes.ok
      ? shelfLifeRes
      : { effectiveDte: 0, sellThroughProbability: 0 };

    // 3. Pricing
    const pricingRes = buildPricingDecision(
      batch,
      effectiveDte,
      sellThroughProbability,
      nowIso
    );
    expect(pricingRes.ok).toBe(true);

    if (pricingRes.ok) {
      // 4. Persist to ledger
      const entry = await ledger.insertEntry({
        entryType: 'PRICING_DECISION',
        batchId,
        storeId: batch.storeId,
        payload: pricingRes.value,
      });

      expect(entry.entryId).toBeDefined();

      // 5. Query back
      const history = ledger.queryEntries(batchId);
      expect(history.length).toBe(1);
      expect(history[0].entryType).toBe('PRICING_DECISION');
      expect((history[0].payload as any).batchId).toBe(batchId);
    }
  });

  it('runs donation cycle when batch has 1–2 days left: generates manifest & persists audit record', async () => {
    const batchId = 'BATCH-DONATE-E2E';
    const batch: PerishableBatch = {
      batchId,
      sku: 'SKU-SALAD-01',
      productName: 'Greek Salad',
      category: 'prepared',
      storeId: 'STORE-001',
      nominalShelfLifeDays: 5,
      expiryDateIso: '2026-10-05T00:00:00Z', // 1.5 days left — still usable by a food bank
      costBasisPerUnit: 2.5,
      msrpPerUnit: 6.99,
      quantityOnHand: 20,
      temperatureHistory: [{ timestampIso: '2026-10-03T00:00:00Z', celsius: 4 }],
      dailySalesVelocity: 2,
      createdAt: '2026-10-01T00:00:00Z',
    };

    const nowIso = '2026-10-03T12:00:00Z';
    const effectiveDte = 1.5;
    const sellThroughProb = 0.15;

    const manifestRes = buildDonationManifest(
      batch,
      effectiveDte,
      sellThroughProb,
      { latitude: 34.05, longitude: -118.25 },
      mockFoodBanks,
      undefined,
      nowIso
    );

    expect(manifestRes.ok).toBe(true);
    if (manifestRes.ok) {
      expect(manifestRes.value.triggerReason).toBe('effective_dte_below_threshold');
      expect(manifestRes.value.donatedQuantityUnits).toBe(20);

      // Persist to audit ledger
      await ledger.insertEntry({
        entryType: 'DONATION_MANIFEST',
        batchId,
        storeId: batch.storeId,
        payload: manifestRes.value,
      });

      const history = ledger.queryEntries(batchId);
      expect(history.length).toBe(1);
      expect(history[0].entryType).toBe('DONATION_MANIFEST');
      expect((history[0].payload as any).irsFormReference).toBe('IRS Form 8283, Section A');
    }
  });
});
