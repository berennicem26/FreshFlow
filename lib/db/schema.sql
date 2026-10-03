-- Audit Ledger: append-only event store
CREATE TABLE IF NOT EXISTS audit_entries (
  entry_id       TEXT    NOT NULL PRIMARY KEY,          -- UUID v4
  entry_type     TEXT    NOT NULL CHECK (entry_type IN (
                   'PRICING_DECISION',
                   'DONATION_MANIFEST',
                   'WEATHER_SYNC',
                   'PRICE_INVARIANT_VIOLATION'
                 )),
  batch_id       TEXT,                                  -- nullable for weather syncs
  store_id       TEXT    NOT NULL,
  occurred_at    TEXT    NOT NULL,                      -- ISO 8601 UTC
  payload        TEXT    NOT NULL                       -- JSON-serialised payload
);

-- Fast lookup by batch_id in chronological order
CREATE INDEX IF NOT EXISTS idx_audit_batch_id
  ON audit_entries (batch_id, occurred_at ASC);

-- Fast lookup for Weather_Sync cache queries
CREATE INDEX IF NOT EXISTS idx_audit_store_type
  ON audit_entries (store_id, entry_type, occurred_at DESC);

-- Append-only enforcement: reject UPDATE and DELETE at the database level
CREATE TRIGGER IF NOT EXISTS prevent_update_audit
  BEFORE UPDATE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is append-only: UPDATE not permitted');
END;

CREATE TRIGGER IF NOT EXISTS prevent_delete_audit
  BEFORE DELETE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is append-only: DELETE not permitted');
END;
