/**
 * tests/db/auditLedger-append-only.test.ts — Verify append-only enforcement
 *
 * This test verifies that the SQLite triggers prevent UPDATE and DELETE operations
 * on the audit_entries table at the database level.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLedger } from '../../lib/db/auditLedger';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';

describe('AuditLedger Append-Only Enforcement', () => {
  const testDbPath = './test-append-only.db';
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

  it('should reject UPDATE operations at the database level', async () => {
    // Insert an entry
    const entry = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-001',
      storeId: 'store-123',
      payload: { tier: 'NONE' } as any,
    });

    // Try to UPDATE directly via SQLite (bypassing the AuditLedger class)
    const db = new Database(testDbPath);
    
    expect(() => {
      db.prepare(`
        UPDATE audit_entries
        SET payload = ?
        WHERE entry_id = ?
      `).run(JSON.stringify({ tier: 'TIER_1' }), entry.entryId);
    }).toThrow(/audit_entries is append-only: UPDATE not permitted/);

    db.close();
  });

  it('should reject DELETE operations at the database level', async () => {
    // Insert an entry
    const entry = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-001',
      storeId: 'store-123',
      payload: { tier: 'NONE' } as any,
    });

    // Try to DELETE directly via SQLite (bypassing the AuditLedger class)
    const db = new Database(testDbPath);
    
    expect(() => {
      db.prepare(`
        DELETE FROM audit_entries
        WHERE entry_id = ?
      `).run(entry.entryId);
    }).toThrow(/audit_entries is append-only: DELETE not permitted/);

    db.close();
  });

  it('should allow INSERT operations normally', async () => {
    // This should work fine
    const entry1 = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-001',
      storeId: 'store-123',
      payload: { tier: 'NONE' } as any,
    });

    const entry2 = await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: 'batch-001',
      storeId: 'store-123',
      payload: { tier: 'TIER_1' } as any,
    });

    expect(entry1.entryId).toBeTruthy();
    expect(entry2.entryId).toBeTruthy();
    expect(entry1.entryId).not.toBe(entry2.entryId);

    const entries = ledger.queryEntries('batch-001');
    expect(entries).toHaveLength(2);
  });
});
