/**
 * lib/db/auditLedger.ts — SQLite-backed imperative shell for audit trail persistence.
 *
 * Responsibilities:
 * - Persist every PricingDecision, DonationManifest, and WeatherSyncRecord to SQLite
 * - Query audit history for a given batchId in chronological order
 * - Enforce append-only semantics (no UPDATE/DELETE operations)
 * - Generate UUID entryIds and ISO 8601 timestamps on insert
 *
 * This is IMPERATIVE SHELL — side effects and I/O are permitted here.
 * The Functional Core never imports this module directly.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AuditEntry } from '../types';

export interface AuditLedgerConfig {
  readonly dbPath: string;
}

/**
 * Custom error class for audit ledger insert failures after all retries exhausted.
 * Thrown when an insert fails 4 times (1 initial + 3 retries).
 */
export class AuditLedgerInsertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditLedgerInsertError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuditLedgerInsertError);
    }
  }
}

/**
 * AuditLedger — SQLite adapter for append-only audit trail.
 *
 * Constructor runs schema.sql to initialize tables, indexes, and triggers.
 * All inserts generate entryId and occurredAtIso automatically.
 * queryEntries returns [] immediately if batchId is null/undefined/empty.
 */
export class AuditLedger {
  private readonly db: Database.Database;

  constructor(config: AuditLedgerConfig) {
    // Open SQLite database (creates file if it doesn't exist)
    this.db = new Database(config.dbPath);

    // Execute schema.sql to create tables, indexes, and triggers
    const schemaPath = join(__dirname, 'schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schemaSql);
  }

  /**
   * Insert an AuditEntry into the ledger with exponential back-off retry logic.
   * Generates entryId (UUID v4) and occurredAtIso (current UTC ISO 8601).
   * Serializes payload to JSON before persisting.
   *
   * Retry schedule:
   * - Attempt 0 (initial): no wait
   * - Attempt 1 (retry 1): wait 100ms (100 × 2^0)
   * - Attempt 2 (retry 2): wait 200ms (100 × 2^1)
   * - Attempt 3 (retry 3): wait 400ms (100 × 2^2)
   * - After attempt 3 fails: throw AuditLedgerInsertError
   *
   * Cap per interval: 1600ms (not reached with 3 retries)
   *
   * @throws {AuditLedgerInsertError} When all 4 attempts (1 initial + 3 retries) fail
   */
  async insertEntry(
    entry: Omit<AuditEntry, 'entryId' | 'occurredAtIso'>
  ): Promise<AuditEntry> {
    const entryId = randomUUID();
    const occurredAtIso = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO audit_entries
        (entry_id, entry_type, batch_id, store_id, occurred_at, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 100;
    const MAX_DELAY_MS = 1600;

    // Attempt 0 is the initial try, then retries 1, 2, 3
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        stmt.run(
          entryId,
          entry.entryType,
          entry.batchId ?? null,
          entry.storeId,
          occurredAtIso,
          JSON.stringify(entry.payload)
        );

        // Success — return the complete AuditEntry
        return {
          ...entry,
          entryId,
          occurredAtIso,
        };
      } catch (error) {
        // If this was the last attempt, throw the custom error
        if (attempt === MAX_RETRIES) {
          throw new AuditLedgerInsertError('failed after 3 retries');
        }

        // Calculate exponential back-off delay: 100 × 2^attempt, capped at 1600ms
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);

        // Wait before next retry (async delay using setTimeout wrapped in Promise)
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // This line is unreachable due to the throw in the loop, but TypeScript requires it
    throw new AuditLedgerInsertError('failed after 3 retries');
  }

  /**
   * Query all audit entries for a given batchId in ascending occurredAtIso order.
   * Returns [] immediately if batchId is null, undefined, or empty string.
   * Deserializes JSON payload on return.
   */
  queryEntries(batchId: string | null | undefined): AuditEntry[] {
    // Early return for null/undefined/empty batchId without querying
    if (!batchId || batchId.trim() === '') {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT entry_id, entry_type, batch_id, store_id, occurred_at, payload
      FROM audit_entries
      WHERE batch_id = ?
      ORDER BY occurred_at ASC
    `);

    const rows = stmt.all(batchId) as Array<{
      entry_id: string;
      entry_type: AuditEntry['entryType'];
      batch_id: string | null;
      store_id: string;
      occurred_at: string;
      payload: string;
    }>;

    return rows.map((row) => ({
      entryId: row.entry_id,
      entryType: row.entry_type,
      batchId: row.batch_id,
      storeId: row.store_id,
      occurredAtIso: row.occurred_at,
      payload: JSON.parse(row.payload),
    }));
  }

  /**
   * Close the database connection.
   * Should be called on application shutdown or test teardown.
   */
  close(): void {
    this.db.close();
  }
}
