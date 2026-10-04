---
inclusion: always
---

# FreshFlow Architecture & Food Safety Rules

These rules are always active across the entire workspace. They define the non-negotiable architectural boundaries and food safety invariants for FreshFlow. Violations are defects — not style preferences.

---

## Part 1 — Architectural Invariants (Functional Core / Imperative Shell)

### 1.1 Pure Functional Core Isolation

All modules in `lib/core/` **MUST** be 100% pure functions:

- **Zero I/O** — no `fetch`, no `fs`, no `http`, no `XMLHttpRequest`
- **No database access** — no `import` of `better-sqlite3`, SQLite, or any ORM
- **No MCP calls** — no references to Open-Meteo or any external service client
- **No side effects** — no `console.log`, no `process.env` reads, no global state mutations
- **No `Date.now()` or `new Date()`** — time must be injected (see Rule 1.3)

This applies to: `thermalCalculator.ts`, `shelfLifeCalculator.ts`, `pricingEngine.ts`, `donationRouter.ts`, `taxValuator.ts`.

Side effects are strictly confined to:

| Location       | Permitted side effects                              |
|----------------|-----------------------------------------------------|
| `lib/shell/`   | Open-Meteo MCP calls, event emission                |
| `lib/db/`      | SQLite reads/writes via `better-sqlite3`            |
| `app/api/`     | HTTP request/response handling (Next.js)            |

```typescript
// ❌ Non-Compliant — core function performs I/O and throws
import Database from 'better-sqlite3'; // FORBIDDEN in lib/core/

async function computeAndPersistPriceBad(batch: PerishableBatch): Promise<number> {
  const db = new Database('audit.db');           // I/O in core — violation
  const price = batch.msrpPerUnit * 0.85;
  db.prepare('INSERT INTO ...').run(price);       // Side effect — violation
  return price;                                   // No floor/ceiling — violation
}

// ✅ Compliant — pure function, no imports beyond types, returns Result<T>
import type { PerishableBatch, PricingDecision, MarkdownTier } from '../types';

function buildPricingDecision(
  batch: PerishableBatch,
  effectiveDte: number,
  sellThroughProbability: number,
  evaluatedAtIso?: string    // injectable clock (Rule 1.3)
): Result<PricingDecision> {
  if (batch.costBasisPerUnit >= batch.msrpPerUnit) {
    return { ok: false, error: 'costBasisPerUnit must be strictly less than msrpPerUnit' };
  }
  const tier = evaluatePricingTier(effectiveDte, sellThroughProbability);
  // ... pure computation only ...
  return { ok: true, value: decision };
}
```

---

### 1.2 Result\<T\> Discriminated Union

All functions in `lib/core/**` **must** return a `Result<T>` discriminated union. Never use `throw` for domain validation errors inside pure logic.

```typescript
// Canonical Result<T> type — defined once in lib/types.ts
type Result<T> =
  | { ok: true;  value: T }
  | { ok: false; error: string };
```

**Rules:**
- Domain validation failures (invalid input ranges, constraint violations) → `{ ok: false, error: '...' }`
- Infrastructure failures (SQLite write errors, MCP timeouts) → named `Error` subclasses thrown from the Imperative Shell only
- Callers in the shell **must** check `result.ok` before accessing `result.value`

```typescript
// ❌ Non-Compliant — throws inside pure core logic
function computeEffectiveDteBad(batch: PerishableBatch, decayFactor: number): number {
  if (decayFactor <= 0) throw new Error('invalid decay factor'); // violation
  return batch.nominalShelfLifeDays / decayFactor;
}

// ✅ Compliant — returns Result<T>, never throws
function computeEffectiveDte(
  batch: Pick<PerishableBatch, 'expiryDateIso' | 'quantityOnHand' | 'dailySalesVelocity'>,
  decayFactor: number,
  nowIso?: string
): Result<{ effectiveDte: number; sellThroughProbability: number }> {
  if (decayFactor <= 0)
    return { ok: false, error: 'computedDecayFactor must be positive' };
  if (batch.quantityOnHand <= 0)
    return { ok: false, error: 'quantityOnHand must be greater than zero' };
  if (batch.dailySalesVelocity < 0)
    return { ok: false, error: 'dailySalesVelocity must be non-negative' };

  const now = nowIso ?? new Date().toISOString();
  const nominalRemainingDays =
    (Date.parse(batch.expiryDateIso) - Date.parse(now)) / 86_400_000;
  const effectiveDte = nominalRemainingDays <= 0 ? 0 : nominalRemainingDays / decayFactor;
  const sellThroughProbability = Math.min(
    1.0,
    (effectiveDte * batch.dailySalesVelocity) / batch.quantityOnHand
  );
  return { ok: true, value: { effectiveDte, sellThroughProbability } };
}
```

---

### 1.3 Deterministic Time & Injectable Clocks

Any core function that depends on the current time **must** accept an optional `nowIso?: string` parameter. When provided, use it in place of `new Date().toISOString()`. When absent, default to the real clock.

```typescript
// ❌ Non-Compliant — non-deterministic, untestable
function computeNominalRemainingDaysBad(expiryDateIso: string): number {
  return (Date.parse(expiryDateIso) - Date.now()) / 86_400_000; // clock leak
}

// ✅ Compliant — clock injected, fully deterministic in tests
function computeNominalRemainingDays(
  expiryDateIso: string,
  nowIso?: string
): number {
  const now = nowIso ?? new Date().toISOString();
  return (Date.parse(expiryDateIso) - Date.parse(now)) / 86_400_000;
}

// Test usage — no jest.useFakeTimers(), no sinon, no mocking needed:
const result = computeNominalRemainingDays('2025-07-16T00:00:00Z', '2025-07-14T00:00:00Z');
// → 2.0  (deterministic)
```

---

### 1.4 Imperative Shell Boundary

The shell orchestrates; the core computes. The shell **must not** contain business logic, and the core **must not** perform I/O.

```
API Route (app/api/)
    │
    ├── calls → WeatherSync (lib/shell/)      ← I/O: Open-Meteo MCP
    ├── calls → AuditLedger (lib/db/)         ← I/O: SQLite
    │
    └── passes plain data ──► Functional Core (lib/core/)
                                    │
                                    └── returns plain Result<T> ──► Shell persists
```

Shell modules receive `Result<T>` from core, check `ok`, then decide whether to persist, respond, or escalate. Business decisions (which tier, whether to donate, IRS deduction amount) always happen in the core.

---

## Part 2 — Food Safety & Operational Rules

### 2.1 Temperature Range Boundary

Ambient temperature readings **must** be within `[−30°C, 60°C]`. Any reading outside this interval represents a sensor fault or data corruption and must be rejected before any thermal calculation.

```typescript
// ✅ Compliant validation — reject before reaching Arrhenius computation
function validateTemperatureHistory(
  history: TemperatureReading[]
): Result<TemperatureReading[]> {
  if (history.length === 0)
    return { ok: false, error: 'temperatureHistory must be non-empty' };

  for (let i = 0; i < history.length; i++) {
    const { celsius } = history[i];
    if (celsius < -30 || celsius > 60) {
      return {
        ok: false,
        error: `celsius value ${celsius} at index ${i} is out of range [−30, 60]`,
      };
    }
  }
  return { ok: true, value: history };
}
```

**Never pass unvalidated sensor data directly to Arrhenius or Q10 computation.**

---

### 2.2 Dynamic Spoilage Acceleration

When average ambient temperature exceeds the reference temperature (typically 4°C for refrigerated produce), the thermal decay factor **must** be strictly greater than 1.0. This is a food safety invariant, not a performance preference — an under-accelerated decay factor causes products to remain on shelves longer than is biologically safe.

- `mean(temperatureHistory) > referenceTemperatureCelsius + 1e-9` → `computedDecayFactor > 1.0`
- `mean(temperatureHistory) ≈ referenceTemperatureCelsius` (within 1e-9) → `computedDecayFactor ≈ 1.0`
- Higher temperature deviation → strictly higher decay factor (monotonicity invariant)

The Arrhenius equation is the primary computation path. The Q10 simplified path is permitted only when `q10Coefficient` is explicitly provided in `[1.0, 5.0]`.

---

### 2.3 Donation Routing Precedence

Routing to a food bank is a **food safety action**, not merely an inventory action. A donation is only useful if the food bank still has time to pick it up and distribute it. The following conditions trigger mandatory donation routing (thresholds in `lib/core/retailPolicy.ts`):

| Condition                                                          | Trigger reason                    |
|--------------------------------------------------------------------|-----------------------------------|
| `1.0 <= effectiveDte <= 2.0` AND `quantityOnHand > 0`              | `effective_dte_below_threshold`   |
| `2.0 < effectiveDte <= 3.0` AND `sellThroughProbability < 0.5` AND `quantityOnHand > 0` | `sell_through_impossible` |

**Precedence rule:** Inside the final window (`effectiveDte <= 2.0`), assign `triggerReason = 'effective_dte_below_threshold'`.

A batch that meets either condition **must not** receive a retail price — it must receive `tier = 'DONATION'` and `computedPricePerUnit = null`.

**Too-late invariant:** A batch with `effectiveDte < 1.0` must **never** produce a `DonationManifest` — it receives `tier = 'PULL'` (removed from sale).

**No premature donation invariant:** A batch with `effectiveDte > 3.0`, or `effectiveDte > 2.0` AND `sellThroughProbability >= 0.5`, must **never** produce a `DonationManifest`.

**Product temperature rule:** Outdoor weather (Open-Meteo or the heatwave slider) is **never** used directly as product temperature. It must first be translated per display zone via `lib/core/storageProfile.ts` (coolers ≈ 4°C with mild heat drift; shelves follow HVAC-dampened indoor temperature), and the decay reference temperature must match the zone.

---

### 2.4 Weather MCP Cache Bound

Cached `WeatherSyncRecord` entries are valid for a **maximum of 24 hours**. Stale weather data causes under-accelerated decay factors and unsafe shelf-life estimates.

| Cache state                                    | Action                                                        |
|------------------------------------------------|---------------------------------------------------------------|
| Cache exists and age ≤ 24 h                    | Use cached record; note `fetchedAtIso` in pricing `rationale` |
| Cache exists and age > 24 h                    | Treat as unavailable                                          |
| No cache or all MCP retries exhausted          | Suspend pricing evaluation; emit failure event; throw `WeatherSyncError` |

When cached data is used, the `PricingDecision.rationale` **must** include:

```
"Pricing decision based on cached weather data (fetchedAt: {fetchedAtIso})"
```

This ensures the audit trail records that a pricing decision was made under degraded data conditions.

---

### 2.5 Append-Only Audit Trail

The SQLite `audit_entries` table is a **legal and compliance record**. It must be strictly append-only.

```typescript
// ❌ Non-Compliant — mutating the audit ledger
db.prepare('UPDATE audit_entries SET payload = ? WHERE entry_id = ?').run(payload, id);
db.prepare('DELETE FROM audit_entries WHERE entry_id = ?').run(id);

// ✅ Compliant — append-only insert pattern
class AuditLedger {
  // No updateEntry() method — intentionally absent
  // No deleteEntry() method — intentionally absent

  insertEntry(
    entry: Omit<AuditEntry, 'entryId' | 'occurredAtIso'>
  ): Promise<AuditEntry> {
    const entryId     = randomUUID();
    const occurredAt  = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO audit_entries
        (entry_id, entry_type, batch_id, store_id, occurred_at, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entryId,
      entry.entryType,
      entry.batchId ?? null,
      entry.storeId,
      occurredAt,
      JSON.stringify(entry.payload)
    );
    return { ...entry, entryId, occurredAtIso: occurredAt };
  }
}
```

The database schema enforces this at the SQLite level with triggers:

```sql
CREATE TRIGGER prevent_update_audit
  BEFORE UPDATE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is append-only: UPDATE not permitted');
END;

CREATE TRIGGER prevent_delete_audit
  BEFORE DELETE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is append-only: DELETE not permitted');
END;
```

**Both the application code and database triggers must independently enforce append-only behaviour.** Defence in depth — removing either layer is a violation.

---

## Quick Reference

| Rule | Scope | Enforcement |
|------|-------|-------------|
| Pure functions only in `lib/core/` | Architecture | No I/O imports; no `throw`; return `Result<T>` |
| Injectable clock (`nowIso?`) | Architecture | Required on any time-dependent core function |
| Temperature readings in `[−30, 60]°C` | Food safety | Reject before Arrhenius/Q10 |
| Decay factor > 1.0 above reference temp | Food safety | Monotonicity invariant; verified by property tests |
| Donation routing on DTE < 0.5 or STP < 0.05 | Food safety | Mandatory; DTE threshold takes precedence |
| Weather cache ≤ 24 h old | Food safety | Stale → suspend pricing; note in rationale |
| Audit ledger append-only | Compliance | No UPDATE/DELETE in code or DB triggers |
