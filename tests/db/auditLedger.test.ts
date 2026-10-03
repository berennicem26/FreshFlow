/**
 * tests/db/auditLedger.test.ts — Integration tests for AuditLedger (Task 4.2 verification)
 *
 * This is a minimal smoke test to verify task 4.2 implementation.
 * Full integration tests will be written in task 4.4.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuditLedger, AuditLedgerInsertError } from '../../lib/db/auditLedger';
import { existsSync, unlinkSync } from 'fs';
import type { AuditEntry, PricingDecision } from '../../lib/types';

describe('AuditLedger (Task 4.2 Smoke Test)', () => {
  const testDbPath = './test-audit.db';
  let ledger: AuditLedger;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    ledger = new AuditLedger({ dbPath: testDbPath });
  });

  afterEach(() => {
    ledger.close();
    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should insert and query a PRICING_DECISION entry', async () => {
    const pricingDecision: PricingDecision = {
      batchId: 'batch-001',
      evaluatedAtIso: '2025-07-14T12:00:00Z',
      effectiveDte: 2.5,
      sellThroughProbability: 0.7,
      tier: 'TIER_1',
      discountRate: 0.15,
      computedPricePerUnit: 4.24,
      salvageFloorPerUnit: 3.0,
      msrpPerUnit: 4.99,
      boundednessVerified: true,
      rationale: 'TIER_1: 15% discount applied',
    };

    const insertedEntry = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-001',
      storeId: 'store-123',
      payload: pricingDecision,
    });

    // Verify entryId and occurredAtIso were generated
    expect(insertedEntry.entryId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(insertedEntry.occurredAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Query by batchId
    const entries = ledger.queryEntries('batch-001');
    expect(entries).toHaveLength(1);
    expect(entries[0].entryId).toBe(insertedEntry.entryId);
    expect(entries[0].entryType).toBe('PRICING_DECISION');
    expect(entries[0].batchId).toBe('batch-001');
    expect(entries[0].storeId).toBe('store-123');
    
    // Verify payload deserialization
    const payload = entries[0].payload as PricingDecision;
    expect(payload.tier).toBe('TIER_1');
    expect(payload.computedPricePerUnit).toBe(4.24);
  });

  it('should return empty array for null batchId', () => {
    const entries = ledger.queryEntries(null);
    expect(entries).toEqual([]);
  });

  it('should return empty array for undefined batchId', () => {
    const entries = ledger.queryEntries(undefined);
    expect(entries).toEqual([]);
  });

  it('should return empty array for empty string batchId', () => {
    const entries = ledger.queryEntries('');
    expect(entries).toEqual([]);
  });

  it('should return empty array for whitespace-only batchId', () => {
    const entries = ledger.queryEntries('   ');
    expect(entries).toEqual([]);
  });

  it('should handle null batchId in entry (for WEATHER_SYNC)', async () => {
    const weatherSync = {
      syncId: 'sync-001',
      storeId: 'store-123',
      fetchedAtIso: '2025-07-14T12:00:00Z',
      locationLatitude: 40.7128,
      locationLongitude: -74.0060,
      readings: [],
      forecastHorizonHours: 48,
    };

    const insertedEntry = await ledger.insertEntry({
      entryType: 'WEATHER_SYNC',
      batchId: null,
      storeId: 'store-123',
      payload: weatherSync,
    });

    expect(insertedEntry.batchId).toBeNull();
    expect(insertedEntry.entryId).toBeTruthy();
  });

  it('should return entries in ascending occurredAtIso order', async () => {
    // Insert three entries for the same batch
    const entry1 = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-002',
      storeId: 'store-123',
      payload: { tier: 'NONE' } as any,
    });

    // Small delay to ensure different timestamps
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    // Insert second entry after a tiny delay
    const entry2 = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-002',
      storeId: 'store-123',
      payload: { tier: 'TIER_1' } as any,
    });

    const entry3 = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-002',
      storeId: 'store-123',
      payload: { tier: 'TIER_2' } as any,
    });

    const entries = ledger.queryEntries('batch-002');
    expect(entries).toHaveLength(3);
    
    // Verify chronological order
    expect(entries[0].entryId).toBe(entry1.entryId);
    expect(entries[1].entryId).toBe(entry2.entryId);
    expect(entries[2].entryId).toBe(entry3.entryId);
    
    // Verify timestamps are in ascending order
    expect(entries[0].occurredAtIso <= entries[1].occurredAtIso).toBe(true);
    expect(entries[1].occurredAtIso <= entries[2].occurredAtIso).toBe(true);
  });
});

describe('AuditLedger Retry Logic (Task 4.3)', () => {
  const testDbPath = './test-audit-retry.db';
  let ledger: AuditLedger;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    ledger = new AuditLedger({ dbPath: testDbPath });
  });

  afterEach(() => {
    ledger.close();
    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should throw AuditLedgerInsertError after 4 failed attempts', async () => {
    // Mock the db.prepare().run() to always fail
    let attemptCount = 0;
    const originalPrepare = (ledger as any).db.prepare;
    
    (ledger as any).db.prepare = vi.fn((sql: string) => {
      const stmt = originalPrepare.call((ledger as any).db, sql);
      const originalRun = stmt.run.bind(stmt);
      
      stmt.run = vi.fn((...args: any[]) => {
        attemptCount++;
        throw new Error('Simulated persistent database error');
      });
      
      return stmt;
    });

    const entry = {
      entryType: 'PRICING_DECISION' as const,
      batchId: 'batch-fail',
      storeId: 'store-123',
      payload: { tier: 'NONE' } as any,
    };

    // Measure execution time to verify exponential back-off delays
    const startTime = Date.now();

    await expect(ledger.insertEntry(entry)).rejects.toThrow(AuditLedgerInsertError);
    
    const elapsedTime = Date.now() - startTime;

    // Verify 4 attempts were made (1 initial + 3 retries)
    expect(attemptCount).toBe(4);
    
    // Total expected delay: 100ms + 200ms + 400ms = 700ms minimum
    // Allow some tolerance for test execution overhead
    expect(elapsedTime).toBeGreaterThan(650);
    
    // Verify error message
    try {
      await ledger.insertEntry(entry);
    } catch (error) {
      expect(error).toBeInstanceOf(AuditLedgerInsertError);
      expect((error as Error).message).toBe('failed after 3 retries');
    }
  });

  it('should successfully insert on the second attempt after one retry', async () => {
    const pricingDecision: PricingDecision = {
      batchId: 'batch-retry',
      evaluatedAtIso: '2025-07-14T12:00:00Z',
      effectiveDte: 2.5,
      sellThroughProbability: 0.7,
      tier: 'TIER_1',
      discountRate: 0.15,
      computedPricePerUnit: 4.24,
      salvageFloorPerUnit: 3.0,
      msrpPerUnit: 4.99,
      boundednessVerified: true,
      rationale: 'TIER_1: 15% discount applied',
    };

    // Mock the db.prepare().run() to fail once, then succeed
    let attemptCount = 0;
    const originalPrepare = (ledger as any).db.prepare;
    
    (ledger as any).db.prepare = vi.fn((sql: string) => {
      const stmt = originalPrepare.call((ledger as any).db, sql);
      const originalRun = stmt.run.bind(stmt);
      
      stmt.run = vi.fn((...args: any[]) => {
        attemptCount++;
        if (attemptCount === 1) {
          // First attempt fails
          throw new Error('Simulated database lock');
        }
        // Second attempt succeeds
        return originalRun(...args);
      });
      
      return stmt;
    });

    const startTime = Date.now();
    const insertedEntry = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-retry',
      storeId: 'store-123',
      payload: pricingDecision,
    });
    const elapsedTime = Date.now() - startTime;

    // Should have taken at least 100ms (first retry delay)
    expect(elapsedTime).toBeGreaterThan(90);
    
    // Verify the entry was inserted successfully
    expect(insertedEntry.entryId).toBeTruthy();
    expect(insertedEntry.batchId).toBe('batch-retry');
    
    // Verify attempt count (1 initial + 1 retry = 2 attempts)
    expect(attemptCount).toBe(2);

    // Query to confirm persistence
    const entries = ledger.queryEntries('batch-retry');
    expect(entries).toHaveLength(1);
    expect(entries[0].entryId).toBe(insertedEntry.entryId);
  });

  it('should apply exponential back-off with correct delays', async () => {
    // Mock to fail exactly 3 times, then succeed on 4th attempt
    let attemptCount = 0;
    const delays: number[] = [];
    let lastAttemptTime = Date.now();
    
    const originalPrepare = (ledger as any).db.prepare;
    
    (ledger as any).db.prepare = vi.fn((sql: string) => {
      const stmt = originalPrepare.call((ledger as any).db, sql);
      const originalRun = stmt.run.bind(stmt);
      
      stmt.run = vi.fn((...args: any[]) => {
        const now = Date.now();
        if (attemptCount > 0) {
          delays.push(now - lastAttemptTime);
        }
        lastAttemptTime = now;
        attemptCount++;
        
        if (attemptCount <= 3) {
          // First 3 attempts fail
          throw new Error('Simulated failure');
        }
        // 4th attempt succeeds
        return originalRun(...args);
      });
      
      return stmt;
    });

    const insertedEntry = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-backoff',
      storeId: 'store-123',
      payload: { tier: 'NONE' } as any,
    });

    // Verify 4 attempts were made (1 initial + 3 retries)
    expect(attemptCount).toBe(4);
    
    // Verify exponential back-off delays (100ms, 200ms, 400ms)
    // Allow 20ms tolerance for test execution overhead
    expect(delays[0]).toBeGreaterThan(90);   // ~100ms
    expect(delays[0]).toBeLessThan(150);
    
    expect(delays[1]).toBeGreaterThan(180);  // ~200ms
    expect(delays[1]).toBeLessThan(250);
    
    expect(delays[2]).toBeGreaterThan(380);  // ~400ms
    expect(delays[2]).toBeLessThan(450);
    
    // Verify successful insertion
    expect(insertedEntry.entryId).toBeTruthy();
  });
});
