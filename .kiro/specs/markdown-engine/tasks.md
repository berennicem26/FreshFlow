# Implementation Plan: FreshFlow Markdown Engine

## Overview

Implement the FreshFlow Markdown Engine as a Functional Core / Imperative Shell TypeScript system across six phases. The Functional Core (Phases 1–3) contains zero I/O and is fully covered by property-based tests using fast-check. The Imperative Shell (Phases 4–5) handles SQLite persistence and Open-Meteo MCP integration. Phase 6 wires everything into Next.js API routes and a real-time dashboard.

All code is TypeScript targeting ES2022, tested with Vitest (`vitest run`), and lives under the module paths defined in the design.

---

## Tasks

- [x] 1. Phase 1 — Functional Core: Thermal & Shelf-Life Calculators
  - [x] 1.1 Define shared TypeScript interfaces in `lib/types.ts`
    - Export all interfaces and types from the Data Models section of the design: `ProductCategory`, `TemperatureReading`, `PerishableBatch`, `ThermalDecayFactors`, `MarkdownTier`, `PricingDecision`, `DonationManifest`, `WeatherSyncRecord`, `AuditEntry`
    - All fields must use `readonly` as specified in the design
    - This file is the single source of truth imported by every other module
    - _Requirements: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10_

  - [x] 1.2 Implement `computeThermalDecayFactor` in `lib/core/thermalCalculator.ts`
    - Export the `ThermalResult` discriminated union type (`{ ok: true; value: ThermalDecayFactors } | { ok: false; error: string }`)
    - Implement Arrhenius path: `decayFactor = exp(−Ea/R × (1/T_mean_K − 1/T_ref_K))` where `Ea = activationEnergyKJ × 1000`, `R = 8.314`, temperatures converted to Kelvin
    - Implement Q10 path: `decayFactor = q10 ^ ((T_mean − T_ref) / 10)`, used when `q10Coefficient` is in `[1.0, 5.0]`
    - Validate: empty/absent history → `"temperatureHistory must be non-empty"`; any celsius < −30 or > 60 → `"celsius value {v} at index {i} is out of range [−30, 60]"`; q10 outside `[1.0, 5.0]` → `"q10Coefficient {v} is outside valid range [1.0, 5.0]"`; `activationEnergyKJ` outside `[10, 200]` → `"activationEnergyKJ {v} is outside valid range [10, 200]"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.3 Implement `computeEffectiveDte` and `sellThroughProbability` in `lib/core/shelfLifeCalculator.ts`
    - Export `ShelfLifeResult` discriminated union type
    - Compute `nominalRemainingDays = (Date.parse(expiryDateIso) − Date.parse(now)) / 86_400_000`; accept optional `nowIso` for test injection
    - If `nominalRemainingDays <= 0`: return `effectiveDte = 0.0`; else `effectiveDte = nominalRemainingDays / decayFactor`
    - Compute `sellThroughProbability = min(1.0, (effectiveDte × dailySalesVelocity) / quantityOnHand)`
    - Validate: `decayFactor <= 0` → `"computedDecayFactor must be positive"`; `quantityOnHand <= 0` → `"quantityOnHand must be greater than zero"`; `dailySalesVelocity < 0` → `"dailySalesVelocity must be non-negative"`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 1.4 Write property tests for thermal monotonicity (Property 1)
    - **Property 1: Thermal monotonicity** — for identical `ThermalDecayFactors`, the history with a higher mean above `referenceTemperatureCelsius` must produce a strictly greater `computedDecayFactor`
    - Define fast-check arbitraries in `tests/arbitraries.ts`: `arbTemperatureReading` (celsius in [−30, 60]), `arbTemperatureHistory` (minLength 1, maxLength 168), `arbThermalFactorsArrhenius`, `arbThermalFactorsQ10`
    - Use `{ numRuns: 500 }` for this property
    - **Validates: Requirements 1.7**

  - [x] 1.5 Write property test for reference temperature identity (Property 2)
    - **Property 2: Reference temperature identity** — when history mean equals `referenceTemperatureCelsius` within 1×10⁻⁹, `computedDecayFactor` must be in `[1 − 1×10⁻⁹, 1 + 1×10⁻⁹]`
    - Clamp all history readings to `T_ref` value to construct the identity input
    - **Validates: Requirements 1.2**

  - [x] 1.6 Write property test for shelf-life inverse monotonicity (Property 3)
    - **Property 3: Shelf-life inverse monotonicity** — for the same batch with positive `nominalRemainingDays`, a higher `decayFactor` must produce a lower or equal `effectiveDte`
    - Define `arbPerishableBatch` arbitrary in `tests/arbitraries.ts` with valid `costBasisPerUnit < msrpPerUnit`, positive `quantityOnHand`, and non-negative `dailySalesVelocity`
    - **Validates: Requirements 2.8**

  - [x] 1.7 Write property test for sell-through probability bounds (Property 8)
    - **Property 8: STP bounds** — `sellThroughProbability` must always be in `[0.0, 1.0]` for any valid input
    - Use `arbPerishableBatch` with generated positive `decayFactor` values
    - **Validates: Requirements 2.6**

  - [x] 1.8 Write unit tests for `thermalCalculator` and `shelfLifeCalculator`
    - `thermalCalculator`: empty history returns error; celsius −31 returns error at correct index; Q10 path with coefficient 2.0 produces expected value; Arrhenius path with known Ea produces expected value
    - `shelfLifeCalculator`: expired batch returns `effectiveDte = 0`; `decayFactor = 1.0` returns `nominalRemainingDays`; `decayFactor = 2.0` halves DTE; zero `quantityOnHand` returns error
    - Place tests in `tests/core/thermalCalculator.test.ts` and `tests/core/shelfLifeCalculator.test.ts`
    - _Requirements: 1.4, 1.6, 2.2, 2.3, 2.5, 2.7_

  - [x] 1.9 Phase 1 checkpoint — ensure all tests pass
    - Run `npm test` and confirm all Phase 1 tests pass with zero failures

---

- [x] 2. Phase 2 — Functional Core: Pricing Engine
  - [x] 2.1 Implement `evaluatePricingTier` in `lib/core/pricingEngine.ts`
    - Evaluate conditions in descending urgency order and return on first match: `DONATION` (dte ≤ 1.0 AND stp < 0.1) → `TIER_3` (dte ≤ 1.0) → `TIER_2` (dte ≤ 2.0) → `TIER_1` (dte ≤ 3.0 AND stp < 0.8) → `NONE`
    - Export `PricingResult` discriminated union type
    - _Requirements: 3.1, 4.1, 5.1, 5.4, 5.5_

  - [x] 2.2 Implement `computeDiscountedPrice` in `lib/core/pricingEngine.ts`
    - Apply discount rates: `TIER_1 = 0.15`, `TIER_2 = 0.35`, `TIER_3 = 0.50`, `NONE = 0.00`
    - Clamp: if `raw < salvageFloor` → return `salvageFloor`; if `raw > msrp` → return `msrp` (defensive ceiling)
    - Always return a value in `[salvageFloor, msrp]`
    - _Requirements: 3.2, 4.2, 5.2, 8.1, 8.2, 8.3_

  - [x] 2.3 Implement `buildPricingDecision` in `lib/core/pricingEngine.ts`
    - Validate `costBasisPerUnit >= msrpPerUnit` → return `{ ok: false, error: "costBasisPerUnit must be strictly less than msrpPerUnit" }`
    - For `DONATION` tier: set `computedPricePerUnit = null`, `boundednessVerified = false`
    - For all other tiers: call `computeDiscountedPrice`, set `boundednessVerified = true` after clamping, build `rationale` string describing the tier and any salvage floor clamp
    - Accept optional `evaluatedAtIso` for test injection; default to `new Date().toISOString()`
    - _Requirements: 3.5, 4.4, 5.1, 5.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 2.4 Write property test for price boundedness (Property 4)
    - **Property 4: Price boundedness** — for any valid batch with `costBasisPerUnit < msrpPerUnit` at any non-DONATION tier, `computedPricePerUnit` must satisfy `costBasisPerUnit ≤ computedPricePerUnit ≤ msrpPerUnit` and `boundednessVerified = true`
    - Use `arbPerishableBatch` filtered to ensure `costBasis < msrp`; generate `effectiveDte` and `stp` values that produce non-DONATION tiers
    - Use `{ numRuns: 500 }`
    - **Validates: Requirements 8.1, 8.5, 8.6**

  - [x] 2.5 Write property test for tier escalation (Property 5)
    - **Property 5: Tier escalation** — when a batch with a prior decision of `effectiveDte > 2.0` is re-evaluated with `effectiveDte ≤ 2.0`, the new tier must be `TIER_2` or higher urgency
    - Generate staged DTE pairs `(prev > 2.0, next ≤ 2.0)` with matching batches
    - **Validates: Requirements 4.5**

  - [x] 2.6 Write unit tests for `pricingEngine`
    - Boundary cases: DTE = 3.0 + STP = 0.79 → `TIER_1`; DTE = 3.0 + STP = 0.80 → `NONE`; DTE = 2.0 → `TIER_2`; DTE = 1.0 + STP = 0.15 → `TIER_3`; DTE = 1.0 + STP = 0.05 → `DONATION`
    - Salvage floor: TIER_3 at 50% drops below cost basis → clamped, rationale mentions salvage floor
    - Invalid input: `costBasis >= msrp` → error
    - DONATION tier: `computedPricePerUnit = null`, `boundednessVerified = false`
    - Place tests in `tests/core/pricingEngine.test.ts`
    - _Requirements: 3.1, 3.3, 3.4, 4.1, 4.3, 5.1, 5.4, 8.4, 8.7_

  - [x] 2.7 Phase 2 checkpoint — ensure all tests pass
    - Run `npm test` and confirm all Phase 2 tests pass with zero failures

---

- [x] 3. Phase 3 — Functional Core: Donation Router & Tax Valuator
  - [x] 3.1 Implement `shouldDonate`, `selectNearestFoodBank`, and `buildDonationManifest` in `lib/core/donationRouter.ts`
    - `shouldDonate`: returns `true` if `effectiveDte < 0.5` OR (`sellThroughProbability < 0.05` AND `effectiveDte <= 1.0`)
    - `selectNearestFoodBank`: filter for `isActive = true`, compute Haversine distance for each, return the closest; return `null` if none active. Haversine: `R = 6371`, use `atan2(sqrt(a), sqrt(1−a))` formula from the design
    - `buildDonationManifest`: set `triggerReason = 'effective_dte_below_threshold'` when `effectiveDte < 0.5` (takes precedence); `'sell_through_impossible'` otherwise; set `donatedQuantityUnits = quantityOnHand`; if no active bank exists, return `{ ok: false, error: ... }`
    - Export `DonationResult` discriminated union and `FoodBank` interface
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 3.2 Implement `computeIrsDeduction` in `lib/core/taxValuator.ts`
    - Validate: `donatedQuantityUnits <= 0` → `"donatedQuantityUnits must be a positive integer"`; `fairMarketValuePerUnit <= 0` → `"fairMarketValuePerUnit must be positive"`; `costBasisTotal < 0` → `"costBasisTotal must be non-negative"`
    - Formula: if `totalFairMarketValue <= costBasisTotal` → `irsDeductionAmount = costBasisTotal`; else compute `base = costBasisTotal + 0.5 × (totalFairMarketValue − costBasisTotal)`, cap at `2 × costBasisTotal`
    - Assign `irsFormReference`: `totalFairMarketValue < 500` → `'IRS Form 8283, Section A'`; `>= 500` → `'IRS Form 8283, Section B'`
    - Export `TaxResult` discriminated union
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

  - [x] 3.3 Write property test for IRS deduction correctness and bounds (Property 6)
    - **Property 6: IRS deduction correctness and bounds** — for any valid manifest, `irsDeductionAmount` must equal the formula result AND satisfy `costBasisTotal ≤ irsDeductionAmount ≤ 2 × costBasisTotal`
    - Define `arbDonationManifest` in `tests/arbitraries.ts`: `donatedQuantityUnits` integer ≥ 1, `fairMarketValuePerUnit > 0`, `costBasisTotal >= 0`
    - Cover all three formula branches: FMV < cost, base < cap, base ≥ cap
    - Use `{ numRuns: 500 }`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5**

  - [x] 3.4 Write property test for no premature donation (Property 7)
    - **Property 7: No premature donation** — for any batch with `effectiveDte >= 0.5` AND `sellThroughProbability >= 0.05`, `shouldDonate()` must return `false` and no manifest may be generated
    - Generate inputs with `dte` in `[0.5, 100]` and `stp` in `[0.05, 1.0]`
    - **Validates: Requirements 6.6**

  - [x] 3.5 Write unit tests for `donationRouter` and `taxValuator`
    - `donationRouter`: no active bank → error; both triggers satisfied → `effective_dte_below_threshold` wins; nearest bank selected correctly by Haversine vs a farther bank; `quantityOnHand = 0` does not trigger
    - `taxValuator`: FMV < cost → `costBasisTotal`; computed base > 2× cap → capped; FMV = 499 → Section A; FMV = 500 → Section B; zero quantity → error
    - Place tests in `tests/core/donationRouter.test.ts` and `tests/core/taxValuator.test.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 7.3, 7.4, 7.6_

  - [x] 3.6 Phase 3 checkpoint — ensure all tests pass
    - Run `npm test` and confirm all Phase 3 tests pass with zero failures

---

- [x] 4. Phase 4 — Imperative Shell: SQLite Audit Ledger
  - [x] 4.1 Create SQLite schema in `lib/db/schema.sql`
    - Create `audit_entries` table with columns: `entry_id TEXT PRIMARY KEY`, `entry_type TEXT CHECK (...)`, `batch_id TEXT`, `store_id TEXT NOT NULL`, `occurred_at TEXT NOT NULL`, `payload TEXT NOT NULL`
    - Create indexes: `idx_audit_batch_id` on `(batch_id, occurred_at ASC)` and `idx_audit_store_type` on `(store_id, entry_type, occurred_at DESC)`
    - Create append-only triggers `prevent_update_audit` (BEFORE UPDATE) and `prevent_delete_audit` (BEFORE DELETE) using `RAISE(ABORT, ...)`
    - All DDL uses `IF NOT EXISTS` for idempotent restarts
    - _Requirements: 9.8_

  - [x] 4.2 Implement `AuditLedger` class in `lib/db/auditLedger.ts`
    - Install `better-sqlite3` and `@types/better-sqlite3` as dependencies
    - Constructor accepts `AuditLedgerConfig` with `dbPath`; run `schema.sql` via `db.exec()` on startup
    - `insertEntry`: generate `entryId` via `crypto.randomUUID()`, set `occurredAtIso` to `new Date().toISOString()`, serialize `payload` to JSON, insert row
    - `queryEntries(batchId)`: return `[]` immediately if `batchId` is null/undefined/empty; otherwise query in ascending `occurred_at` order, deserialize JSON payload, return `AuditEntry[]`
    - `close()`: close the database connection
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7_

  - [x] 4.3 Implement exponential back-off retry logic in `AuditLedger.insertEntry`
    - Wrap the insert in a retry loop: up to 3 retries after initial failure; wait `100 × 2^attempt` ms between attempts (100 ms, 200 ms, 400 ms), capped at 1600 ms per interval
    - After 4 total attempts all failed, throw `AuditLedgerInsertError: "failed after 3 retries"`
    - Export `AuditLedgerInsertError` as a named error class extending `Error`
    - _Requirements: 9.5_

  - [x] 4.4 Write integration tests for `auditLedger`
    - Use an in-memory or temp-file SQLite database for test isolation
    - Round-trip: `insertEntry` for each `entryType` → `queryEntries` returns correct deserialized record
    - Ordering: insert three entries with known timestamps out of order → `queryEntries` returns them in ascending `occurredAtIso` order
    - Empty `batchId`: `queryEntries('')` and `queryEntries(null)` return `[]` without querying
    - Retry: mock the SQLite insert to fail twice then succeed → entry is eventually inserted; mock to fail four times → `AuditLedgerInsertError` is thrown
    - Append-only: attempt a direct UPDATE or DELETE on the table → SQLite trigger raises `ABORT`
    - Place tests in `tests/db/auditLedger.test.ts`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 4.5 Phase 4 checkpoint — ensure all tests pass
    - Run `npm test` and confirm all Phase 4 tests pass with zero failures

---

- [x] 5. Phase 5 — Imperative Shell: Weather Sync
  - [x] 5.1 Implement `WeatherSync` class in `lib/shell/weatherSync.ts`
    - Constructor accepts an `AuditLedger` instance
    - Implement coordinate validation: lat outside `[−90, 90]` → emit `'config_error'` event with `field: 'latitude'`; lon outside `[−180, 180]` → emit with `field: 'longitude'`; throw after emitting
    - Implement 60-minute sync interval guard in `fetchAndStore`: if last sync for `storeId` was < 60 min ago, return the cached `WeatherSyncRecord` from the ledger
    - Implement `forceSync` that bypasses the interval guard
    - _Requirements: 10.6, 10.7_

  - [x] 5.2 Implement Open-Meteo MCP call and retry logic in `WeatherSync`
    - Call `mcpClient.callTool('get_forecast', { latitude, longitude, hourly: ['temperature_2m'], forecast_days: 2, timezone: 'UTC' })`
    - Implement `transformToWeatherSyncRecord`: map `hourly.time[i]` + `hourly.temperature_2m[i]` to `TemperatureReading[]`; set `syncId = randomUUID()`, `fetchedAtIso = new Date().toISOString()`, `forecastHorizonHours = readings.length`
    - On success: insert `WeatherSyncRecord` into `AuditLedger` as `WEATHER_SYNC` entry, return record
    - On failure: wait 30 s, retry; after 2 retries exhausted → load latest `WeatherSyncRecord` from ledger for that `storeId`
    - If cached record exists and `fetchedAtIso` is within 24 h → return cached record
    - If no valid cache → emit failure event, throw `WeatherSyncError`
    - Export `WeatherSyncError` as a named error class
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 5.3 Write integration tests for `weatherSync`
    - Successful fetch: mock MCP client returns valid Open-Meteo response → `WeatherSyncRecord` is correctly transformed and inserted into ledger
    - Cache fallback: mock MCP to fail all retries; pre-populate ledger with a record < 24 h old → `fetchAndStore` returns cached record
    - Cache expiry: mock MCP to fail; cached record is > 24 h old → `WeatherSyncError` is thrown
    - Interval guard: call `fetchAndStore` twice within 60 min → MCP called only once
    - Invalid lat/lon: out-of-range values → `config_error` event emitted, sync skipped
    - Place tests in `tests/shell/weatherSync.test.ts`
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6, 10.7_

  - [x] 5.4 Phase 5 checkpoint — ensure all tests pass
    - Run `npm test` and confirm all Phase 5 tests pass with zero failures

---

- [x] 6. Phase 6 — Next.js API Routes & Dashboard
  - [x] 6.1 Create Zod validation schemas for all request/response bodies
    - Define schemas in `lib/schemas.ts`: `PerishableBatchSchema`, `EvaluateRequestSchema`, `DonationDispatchSchema`, `AuditQuerySchema`, `WeatherSyncRequestSchema`
    - Export inferred TypeScript types alongside each schema
    - _Requirements: all API-touching requirements_

  - [x] 6.2 Implement batch API routes in `app/api/batches/route.ts`
    - `POST /api/batches`: parse and validate body with `PerishableBatchSchema`; persist batch (in-memory store or SQLite table); return 201 with the created batch
    - `GET /api/batches`: return list of all registered batches
    - Return 400 with Zod error details on validation failure; 500 on unhandled shell errors
    - _Requirements: 9.1_

  - [x] 6.3 Implement batch evaluation route in `app/api/batches/[batchId]/evaluate/route.ts`
    - `POST /api/batches/[batchId]/evaluate`: retrieve batch; call `WeatherSync.fetchAndStore` → `computeThermalDecayFactor` → `computeEffectiveDte` → `buildPricingDecision`; if `tier = 'DONATION'` call `buildDonationManifest` → `computeIrsDeduction`; insert all results into `AuditLedger`; return full `PricingDecision` (and `DonationManifest` if applicable)
    - When using cached weather data, append rationale note: `"Pricing decision based on cached weather data (fetchedAt: {fetchedAtIso})"`
    - Return 404 if batch not found; 400 on validation errors; 500 on shell errors
    - _Requirements: 3, 4, 5, 6, 7, 8, 9, 10.8_

  - [x] 6.4 Implement donation and audit routes
    - `app/api/donations/route.ts`: `GET` returns all `DonationManifest` audit entries; `POST /api/donations` with `{ manifestId }` marks a manifest as dispatched (insert a follow-up audit entry)
    - `app/api/audit/route.ts`: `GET` with `?batchId=` query param calls `AuditLedger.queryEntries(batchId)` and returns the audit trail; return 400 if `batchId` is missing
    - _Requirements: 9.6_

  - [x] 6.5 Implement weather sync API route in `app/api/weather/sync/route.ts`
    - `POST /api/weather/sync`: validate body has `storeId`, `latitude`, `longitude`; call `WeatherSync.forceSync`; return the resulting `WeatherSyncRecord`
    - Return 400 on validation failure; 503 if `WeatherSyncError` is thrown (no valid cache)
    - _Requirements: 10.1, 10.7_

  - [x] 6.6 Build dashboard page at `app/dashboard/page.tsx`
    - Server component that fetches active batches from `/api/batches` and their latest `PricingDecision` from the audit ledger
    - Render a table with columns: batch name, SKU, expiry date, effective DTE countdown, tier badge, computed price
    - Tier badge colours: green (`NONE`), yellow (`TIER_1`), orange (`TIER_2`), red (`TIER_3`), purple (`DONATION`)
    - Use Tailwind CSS classes for badge colours; ensure colour is not the sole indicator (include tier label text for accessibility)
    - _Requirements: 3, 4, 5_

  - [x] 6.7 Build donation manifest page at `app/donations/page.tsx`
    - Server component that fetches all `DonationManifest` audit entries
    - Render a table with columns: batch ID, recipient food bank, donated quantity, total FMV, IRS deduction amount, IRS form reference, trigger reason, generated date
    - Show an aggregated total of all `irsDeductionAmount` values as a summary line
    - _Requirements: 6, 7_

  - [x] 6.8 Write end-to-end smoke tests for the evaluation pipeline
    - Test: `POST /api/batches` → `POST /api/batches/{id}/evaluate` → `GET /api/audit?batchId={id}` returns at least one `PRICING_DECISION` entry
    - Test: evaluation with `effectiveDte <= 1.0` and `stp < 0.1` produces a `DONATION_MANIFEST` audit entry
    - Place tests in `tests/e2e/evaluationPipeline.test.ts`; use a test SQLite database to avoid side effects
    - _Requirements: 9.1, 9.2_

  - [x] 6.9 Final build verification
    - Run `npm run build` and confirm zero TypeScript errors and a clean production build
    - Run `npm test` and confirm all tests pass

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; core functionality works without them but invariants will be unverified
- Each task references the requirements it satisfies for full traceability
- Property tests use fast-check with `numRuns: 500` for critical invariants (P1, P4, P6); default 100 runs for others
- All Core functions return discriminated unions (`{ ok: true; ... } | { ok: false; error: string }`) — never throw
- The Imperative Shell (Phases 4–5) is the only place that performs I/O; Core functions remain pure throughout
- `better-sqlite3` is synchronous; `AuditLedger.insertEntry` returns a `Promise` only to accommodate the async retry delay
- Test files live under `tests/` matching the `include: ['tests/**/*.test.ts']` pattern in `vitest.config.ts`
- Custom fast-check arbitraries are centralised in `tests/arbitraries.ts` and imported by all property test files

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2", "2.3"] },
    { "id": 5, "tasks": ["2.4", "2.5", "2.6"] },
    { "id": 6, "tasks": ["3.1", "3.2"] },
    { "id": 7, "tasks": ["3.3", "3.4", "3.5"] },
    { "id": 8, "tasks": ["4.1"] },
    { "id": 9, "tasks": ["4.2"] },
    { "id": 10, "tasks": ["4.3"] },
    { "id": 11, "tasks": ["4.4"] },
    { "id": 12, "tasks": ["5.1"] },
    { "id": 13, "tasks": ["5.2"] },
    { "id": 14, "tasks": ["5.3"] },
    { "id": 15, "tasks": ["6.1"] },
    { "id": 16, "tasks": ["6.2", "6.5"] },
    { "id": 17, "tasks": ["6.3", "6.4"] },
    { "id": 18, "tasks": ["6.6", "6.7"] },
    { "id": 19, "tasks": ["6.8"] },
    { "id": 20, "tasks": ["6.9"] }
  ]
}
```
