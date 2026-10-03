# Requirements Document

## Introduction

FreshFlow is an intelligent food spoilage and dynamic markdown engine for grocery retailers. It continuously monitors perishable inventory, applies Arrhenius-based thermal decay modelling to compute biologically accurate shelf-life, and automatically applies tiered price markdowns to maximise sell-through before expiry. Batches that cannot clear in time are routed to registered food bank partners, generating IRS Section 170(e)(3)-compliant tax deduction manifests. Every pricing and donation decision is persisted to an immutable SQLite audit ledger.

This document specifies the functional requirements for the FreshFlow Markdown Engine, covering the Thermal Calculator, Shelf-Life Calculator, Pricing Engine, Donation Router, Tax Valuator, Audit Ledger, and Weather Sync components.

## Executive Summary & Problem Statement

Grocery retailers lose between **8% and 14% of perishable inventory value** annually to avoidable spoilage — a structural inefficiency driven by static, calendar-based markdown policies that cannot adapt to real-world conditions. When a tray of strawberries priced at $4.99 sits unsold on a 32 °C summer afternoon, three harmful outcomes compound simultaneously: the product spoils before any discount triggers, the retailer absorbs full shrink cost, and the food bank that could have accepted a usable donation receives nothing.

The root cause is that existing markdown engines operate on time-only schedules ("discount on day N before expiry") and ignore two critical accelerating variables: **ambient temperature** (which follows Arrhenius kinetics to shorten biological shelf-life non-linearly) and **sales velocity** (which determines whether remaining stock can physically clear before the expiry window closes).

**FreshFlow** solves this by building a Functional Core / Imperative Shell system that:

1. Continuously ingests real-time ambient temperature from Open-Meteo weather MCP.
2. Applies Arrhenius-based thermal decay factors to recompute effective days-to-expiry for each batch.
3. Runs a tiered markdown engine that applies 15 %, 35 %, or 50 % discounts based on the intersection of effective shelf-life and velocity-adjusted sell-through probability.
4. Automatically routes stock that cannot sell in time to registered food bank partners, generating IRS Section 170(e)(3)-compliant tax deduction manifests.
5. Persists every pricing decision and routing event to an immutable SQLite audit ledger.

The economic opportunity is material: a 200-store regional chain running $2 M/year in perishable sales per store loses roughly $20–28 M annually to spoilage. Recovering 40 % of avoidable shrink via timely markdown and donation routing represents $8–11 M in recovered value per chain.

---

## Glossary

- **Markdown_Engine**: The FreshFlow subsystem responsible for computing discount tiers, donation routing, and tax deduction valuations for perishable batches.
- **Thermal_Calculator**: The pure functional module that computes Arrhenius-based thermal decay factors from temperature time-series data.
- **Shelf_Life_Calculator**: The pure functional module that converts nominal shelf-life and thermal decay history into effective days-to-expiry.
- **Pricing_Engine**: The pure functional module that applies markdown tiers, enforces price invariant bounds, and produces a `PricingDecision`.
- **Donation_Router**: The pure functional module that determines whether a batch should be routed to a food bank and generates a `DonationManifest`.
- **Tax_Valuator**: The pure functional module that computes IRS Section 170(e)(3) fair market value deduction amounts.
- **Audit_Ledger**: The SQLite-backed imperative shell component that persists every pricing decision and donation event.
- **Weather_Sync**: The imperative shell component that fetches ambient temperature data from the Open-Meteo MCP integration.
- **PerishableBatch**: A record representing a single SKU lot with expiry date, quantity, cost basis, MSRP, and temperature history.
- **MarkdownTier**: An enumerated discount tier (TIER_1, TIER_2, TIER_3, DONATION) with associated discount rate and eligibility rules.
- **ThermalDecayFactor**: A dimensionless multiplier (≥ 1.0) derived from Arrhenius kinetics representing shelf-life acceleration due to temperature.
- **DonationManifest**: A structured record documenting batch quantity, fair market value, recipient food bank, and IRS deduction basis.
- **MSRP**: Manufacturer's Suggested Retail Price — the full retail price before any markdown.
- **Salvage_Floor**: The minimum acceptable sale price, defined as the cost basis of a batch.
- **Effective_DTE**: Effective Days-to-Expiry — the biologically adjusted remaining shelf-life after applying thermal decay.
- **Sales_Velocity**: The historical daily unit sales rate for a given SKU at a given store location.
- **Sell_Through_Probability**: The probability that remaining batch quantity will sell before the effective expiry, computed from sales velocity and effective DTE.
- **Open-Meteo_MCP**: The Model Context Protocol server integration that provides real-time and forecast ambient temperature data.
- **Q10_Coefficient**: A biological rate constant (typically 2.0–3.0) representing the factor by which biological decay rates increase per 10 °C rise in temperature.
- **Reference_Temperature**: The baseline storage temperature (typically 4 °C for refrigerated produce) against which thermal acceleration is computed.

---

## Architecture Overview

FreshFlow adopts a **Functional Core / Imperative Shell** architecture. All mathematical logic is isolated in pure, side-effect-free TypeScript functions that take plain data in and return plain data out. External I/O — database writes, HTTP calls to Open-Meteo, file system access — is confined to thin imperative shell adapters at the boundary. This enables exhaustive property-based testing of all pricing logic without mocking infrastructure.

```
┌─────────────────────────────────────────────────────────┐
│                   IMPERATIVE SHELL                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Weather_Sync │  │ Audit_Ledger │  │  API Routes  │  │
│  │ (Open-Meteo) │  │   (SQLite)   │  │  (Next.js)   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └─────────────────┼─────────────────┘           │
│                           │                             │
│               Plain TypeScript data                     │
└───────────────────────────┼─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                   FUNCTIONAL CORE                       │
│                                                         │
│  ┌────────────────────┐   ┌────────────────────────┐    │
│  │ Thermal_Calculator │   │ Shelf_Life_Calculator  │    │
│  │  (Arrhenius Eq.)   │   │  (Effective DTE)       │    │
│  └────────────────────┘   └────────────────────────┘    │
│                                                         │
│  ┌────────────────────┐   ┌────────────────────────┐    │
│  │  Pricing_Engine    │   │   Donation_Router      │    │
│  │  (Tier 1/2/3)      │   │   (Route / Manifest)   │    │
│  └────────────────────┘   └────────────────────────┘    │
│                                                         │
│  ┌────────────────────┐                                 │
│  │   Tax_Valuator     │                                 │
│  │  (IRS 170(e)(3))   │                                 │
│  └────────────────────┘                                 │
└─────────────────────────────────────────────────────────┘
```

**Key architectural invariants:**
- Functions in the Functional Core are pure: given the same inputs, they always return the same outputs.
- The Imperative Shell passes data into the Functional Core and receives plain data objects back; it never calls Core functions for their side effects.
- All database writes and external HTTP calls occur exclusively in the Imperative Shell.
- TypeScript interfaces defined in the Data Models section serve as the contract between shell and core.

---

## Data Models & TypeScript Interfaces

```typescript
// The nominal product category for temperature reference lookup
type ProductCategory = 'produce' | 'dairy' | 'meat' | 'bakery' | 'prepared';

// A single ambient temperature reading with ISO 8601 timestamp
interface TemperatureReading {
  readonly timestampIso: string;   // e.g. "2025-07-14T09:00:00Z"
  readonly celsius: number;        // ambient temperature in °C
}

// A perishable lot received from a supplier or produced in-store
interface PerishableBatch {
  readonly batchId: string;                        // UUID v4
  readonly sku: string;                            // retailer SKU code
  readonly productName: string;
  readonly category: ProductCategory;
  readonly storeId: string;
  readonly nominalShelfLifeDays: number;           // days at reference temperature
  readonly expiryDateIso: string;                  // ISO 8601 calendar expiry
  readonly costBasisPerUnit: number;               // USD, the Salvage_Floor per unit
  readonly msrpPerUnit: number;                    // USD, full retail price
  readonly quantityOnHand: number;                 // units currently in store
  readonly temperatureHistory: TemperatureReading[]; // chronological readings
  readonly dailySalesVelocity: number;             // units sold per day (7-day avg)
  readonly createdAt: string;                      // ISO 8601
}

// Arrhenius-derived thermal acceleration parameters for a product category
interface ThermalDecayFactors {
  readonly referenceTemperatureCelsius: number;    // baseline °C (typically 4 °C)
  readonly q10Coefficient: number;                 // typically 2.0–3.0
  readonly activationEnergyKJ: number;             // Ea in kJ/mol
  readonly computedDecayFactor: number;            // dimensionless multiplier ≥ 1.0
  readonly effectiveDteReductionDays: number;      // days shaved off nominal shelf-life
}

// The output of a single pricing engine evaluation
type MarkdownTier = 'NONE' | 'TIER_1' | 'TIER_2' | 'TIER_3' | 'DONATION';

interface PricingDecision {
  readonly batchId: string;
  readonly evaluatedAtIso: string;
  readonly effectiveDte: number;                   // decimal days after thermal adjustment
  readonly sellThroughProbability: number;         // 0.0–1.0
  readonly tier: MarkdownTier;
  readonly discountRate: number;                   // 0.0–0.5
  readonly computedPricePerUnit: number;           // USD, after discount
  readonly salvageFloorPerUnit: number;            // USD, lower bound enforced
  readonly msrpPerUnit: number;                    // USD, upper bound enforced
  readonly boundednessVerified: boolean;           // true iff salvageFloor < price <= msrp
  readonly rationale: string;                      // human-readable explanation
}

// A food bank donation routing record
interface DonationManifest {
  readonly manifestId: string;                     // UUID v4
  readonly batchId: string;
  readonly generatedAtIso: string;
  readonly recipientFoodBankId: string;
  readonly recipientFoodBankName: string;
  readonly donatedQuantityUnits: number;
  readonly fairMarketValuePerUnit: number;         // USD, per IRS 170(e)(3)
  readonly totalFairMarketValue: number;           // USD
  readonly costBasisTotal: number;                 // USD, for IRS deduction formula
  readonly irsDeductionAmount: number;             // USD, cost + 0.5*(FMV - cost), capped at 2×cost
  readonly irsFormReference: string;               // e.g. "IRS Form 8283, Section A"
  readonly triggerReason: 'effective_dte_below_threshold' | 'sell_through_impossible';
}

// A synchronised weather record from Open-Meteo MCP
interface WeatherSyncRecord {
  readonly syncId: string;                         // UUID v4
  readonly storeId: string;
  readonly fetchedAtIso: string;
  readonly locationLatitude: number;
  readonly locationLongitude: number;
  readonly readings: TemperatureReading[];         // hourly forecast or actuals
  readonly forecastHorizonHours: number;           // typically 48 or 168
}

// An immutable audit log entry written to the SQLite Audit_Ledger
interface AuditEntry {
  readonly entryId: string;                        // UUID v4
  readonly entryType: 'PRICING_DECISION' | 'DONATION_MANIFEST' | 'WEATHER_SYNC' | 'PRICE_INVARIANT_VIOLATION';
  readonly batchId: string | null;
  readonly storeId: string;
  readonly occurredAtIso: string;
  readonly payload: PricingDecision | DonationManifest | WeatherSyncRecord | string;
}
```

---

## Requirements

### Requirement 1: Ambient Thermal Spoilage Acceleration

**User Story:** As a store operations manager, I want the system to compute how much faster perishable products spoil at elevated ambient temperatures, so that markdown decisions reflect biological reality rather than calendar dates alone.

#### Acceptance Criteria

1. WHEN the Thermal_Calculator receives a `PerishableBatch` with a non-empty `temperatureHistory` and a `ThermalDecayFactors` configuration, THE Thermal_Calculator SHALL compute a dimensionless `computedDecayFactor` using the Arrhenius equation: `k(T) = A × exp(−Ea / (R × T))`, where `T` is absolute temperature in Kelvin, `Ea` is activation energy in J/mol with a value in the range 10,000 to 200,000 J/mol, and `R` is 8.314 J/(mol·K).
2. WHEN the arithmetic mean of all `celsius` values in `temperatureHistory` equals the `referenceTemperatureCelsius` within an absolute tolerance of 1×10⁻⁹, THE Thermal_Calculator SHALL return a `computedDecayFactor` within the range [1.0 − 1×10⁻⁹, 1.0 + 1×10⁻⁹].
3. WHEN the arithmetic mean of all `celsius` values in `temperatureHistory` exceeds the `referenceTemperatureCelsius` by more than 1×10⁻⁹, THE Thermal_Calculator SHALL return a `computedDecayFactor` strictly greater than 1.0.
4. IF `temperatureHistory` is empty or absent, or IF any reading in `temperatureHistory` contains a `celsius` value below −30 or above 60, THEN THE Thermal_Calculator SHALL reject the input and return a descriptive validation error identifying the specific validation failure.
5. WHERE a `q10Coefficient` in the range 1.0 to 5.0 (inclusive) is provided in `ThermalDecayFactors`, WHEN the Thermal_Calculator receives a valid `PerishableBatch`, THE Thermal_Calculator SHALL compute `computedDecayFactor` using the Q10 formula `factor = q10 ^ ((T_mean − T_ref) / 10)` in place of the Arrhenius computation, where `T_mean` is the arithmetic mean of all `celsius` values in `temperatureHistory` and `T_ref` is `referenceTemperatureCelsius`.
6. IF a `q10Coefficient` outside the range 1.0 to 5.0 is provided, THEN THE Thermal_Calculator SHALL reject the input and return a descriptive validation error indicating the invalid coefficient value.
7. THE Thermal_Calculator SHALL ensure that for any two valid `PerishableBatch` inputs sharing identical `ThermalDecayFactors`, a batch whose `temperatureHistory` arithmetic mean exceeds the `referenceTemperatureCelsius` by a greater margin SHALL produce a `computedDecayFactor` strictly greater than a batch whose mean exceeds `referenceTemperatureCelsius` by a lesser margin (monotonicity invariant).

---

### Requirement 2: Biological Shelf-Life & Effective Days-to-Expiry Calculation

**User Story:** As a store operations manager, I want the system to compute the biologically adjusted remaining shelf-life for each batch, so that pricing decisions are triggered at the right time before a product becomes unsafe to sell.

#### Acceptance Criteria

1. WHEN the Shelf_Life_Calculator receives a `PerishableBatch` and a computed `ThermalDecayFactors` record with `computedDecayFactor` greater than 0.0, THE Shelf_Life_Calculator SHALL compute `effectiveDte = nominalRemainingDays / computedDecayFactor`, where `nominalRemainingDays` is the fractional calendar days from the current UTC timestamp to `expiryDateIso`.
2. IF `nominalRemainingDays` is zero or negative, THEN THE Shelf_Life_Calculator SHALL return an `effectiveDte` of 0.0 regardless of `computedDecayFactor`.
3. IF `nominalRemainingDays` is positive and `computedDecayFactor` is exactly 1.0, THEN THE Shelf_Life_Calculator SHALL return an `effectiveDte` equal to `nominalRemainingDays` with no reduction.
4. IF `nominalRemainingDays` is positive and `computedDecayFactor` is greater than 1.0, THEN THE Shelf_Life_Calculator SHALL return an `effectiveDte` strictly less than `nominalRemainingDays`.
5. IF `computedDecayFactor` is zero or negative, THEN THE Shelf_Life_Calculator SHALL reject the input and return a descriptive validation error indicating an invalid decay factor.
6. WHEN the Shelf_Life_Calculator computes a valid `effectiveDte` and `quantityOnHand` is greater than 0, THE Shelf_Life_Calculator SHALL compute `sellThroughProbability = min(1.0, (effectiveDte × dailySalesVelocity) / quantityOnHand)`.
7. IF `quantityOnHand` is zero or `dailySalesVelocity` is less than 0.0, THEN THE Shelf_Life_Calculator SHALL reject the input and return a descriptive validation error identifying the offending field.
8. THE Shelf_Life_Calculator SHALL ensure that for any two valid inputs sharing the same `PerishableBatch`, an input with a higher `computedDecayFactor` SHALL produce an `effectiveDte` less than or equal to the `effectiveDte` produced by an input with a lower `computedDecayFactor` (inverse monotonicity invariant).

---

### Requirement 3: Tier 1 Moderate Markdown

**User Story:** As a store pricing manager, I want the system to apply a 15% discount to batches with 3 or fewer effective days remaining and low sell-through probability, so that moderately time-pressured stock moves before the aggressive markdown window opens.

#### Acceptance Criteria

1. WHEN the Pricing_Engine evaluates a `PerishableBatch` with `effectiveDte` less than or equal to 3.0 days AND `sellThroughProbability` less than 0.8, THE Pricing_Engine SHALL assign `tier = 'TIER_1'` with `discountRate = 0.15`.
2. WHEN `tier` is `TIER_1`, THE Pricing_Engine SHALL compute `computedPricePerUnit = msrpPerUnit × (1 − 0.15)` before applying salvage floor enforcement.
3. WHEN `effectiveDte` is greater than 3.0 days, THE Pricing_Engine SHALL NOT assign `tier = 'TIER_1'` regardless of `sellThroughProbability`.
4. WHEN `sellThroughProbability` is 0.8 or greater and `effectiveDte` is less than or equal to 3.0 days, THE Pricing_Engine SHALL NOT assign `tier = 'TIER_1'`.
5. IF the `computedPricePerUnit` after the 15% discount falls below `costBasisPerUnit`, THEN THE Pricing_Engine SHALL set `computedPricePerUnit` to `costBasisPerUnit` and set `rationale` to a string that identifies the salvage floor as the constraining factor and includes the pre-floor computed value.

---

### Requirement 4: Tier 2 Aggressive Markdown

**User Story:** As a store pricing manager, I want the system to apply a 35% discount to batches with 2 or fewer effective days remaining, so that stock at high spoilage risk sells through quickly regardless of historical velocity.

#### Acceptance Criteria

1. WHEN the Pricing_Engine evaluates a `PerishableBatch` with `effectiveDte` less than or equal to 2.0 days, THE Pricing_Engine SHALL assign `tier = 'TIER_2'` with `discountRate = 0.35`, superseding any prior tier assignment.
2. WHEN `tier` is `TIER_2`, THE Pricing_Engine SHALL compute `computedPricePerUnit = msrpPerUnit × (1 − 0.35)` before applying salvage floor enforcement.
3. WHEN `effectiveDte` is greater than 2.0 days, THE Pricing_Engine SHALL NOT assign `tier = 'TIER_2'`.
4. IF the `computedPricePerUnit` after the 35% discount falls below `costBasisPerUnit` and `costBasisPerUnit` is greater than 0.0, THEN THE Pricing_Engine SHALL set `computedPricePerUnit` to `costBasisPerUnit` and set `rationale` to a string that identifies the salvage floor as the constraining factor and includes the pre-floor computed value.
5. WHEN a `PerishableBatch` with a recorded `PricingDecision` having `effectiveDte` greater than 2.0 is re-evaluated and its new `effectiveDte` is less than or equal to 2.0, THE Pricing_Engine SHALL produce a new `PricingDecision` with `tier = 'TIER_2'` (tier escalation invariant).

---

### Requirement 5: Tier 3 Clearance Floor

**User Story:** As a store pricing manager, I want the system to apply a 50% discount to batches with 1 or fewer effective days remaining, so that near-expiry stock clears at maximum velocity while remaining profitable above cost.

#### Acceptance Criteria

1. WHEN the Pricing_Engine evaluates a `PerishableBatch` with `effectiveDte` less than or equal to 1.0 day, THE Pricing_Engine SHALL assign `tier = 'TIER_3'` with `discountRate = 0.50` and record in `rationale` that the clearance tier was assigned, superseded by DONATION only per criterion 4.
2. WHEN `tier` is `TIER_3`, THE Pricing_Engine SHALL compute `computedPricePerUnit = msrpPerUnit × (1 − 0.50)` before applying salvage floor enforcement.
3. IF the `computedPricePerUnit` after the 50% discount falls below `costBasisPerUnit`, THEN THE Pricing_Engine SHALL set `computedPricePerUnit` to `costBasisPerUnit` and record in `rationale` that the clearance price was clamped to the salvage floor.
4. WHEN `effectiveDte` is less than or equal to 1.0 day and `sellThroughProbability` is less than 0.1, THE Pricing_Engine SHALL set `tier = 'DONATION'` and set `computedPricePerUnit` to `null`, delegating to the Donation_Router for routing rather than issuing a retail price.
5. THE Pricing_Engine SHALL resolve any batch evaluation by selecting the single highest-urgency tier from {DONATION, TIER_3, TIER_2, TIER_1, NONE} in descending urgency order and discarding all lower-urgency tier assignments, so that exactly one tier is present in each `PricingDecision`.

---

### Requirement 6: Food Bank Donation Routing

**User Story:** As a sustainability director, I want the system to automatically route batches that cannot sell before expiry to registered food bank partners, so that edible food is diverted from waste streams and the retailer captures a charitable deduction.

#### Acceptance Criteria

1. WHEN the Donation_Router receives a `PerishableBatch` with `effectiveDte` less than 0.5 days and `quantityOnHand` greater than 0, THE Donation_Router SHALL generate a `DonationManifest` for the full `quantityOnHand`, assign `triggerReason = 'effective_dte_below_threshold'`, and set `donatedQuantityUnits` equal to `quantityOnHand` at evaluation time.
2. WHEN the Donation_Router receives a `PerishableBatch` where `sellThroughProbability` is less than 0.05 and `effectiveDte` is less than or equal to 1.0 day and `quantityOnHand` is greater than 0, THE Donation_Router SHALL generate a `DonationManifest`, assign `triggerReason = 'sell_through_impossible'`, and set `donatedQuantityUnits` equal to `quantityOnHand`.
3. IF both the `effective_dte_below_threshold` and `sell_through_impossible` trigger conditions are simultaneously satisfied, THEN THE Donation_Router SHALL assign `triggerReason = 'effective_dte_below_threshold'`.
4. WHEN the Donation_Router generates a `DonationManifest`, THE Donation_Router SHALL select the `recipientFoodBankId` from the configured list of registered food bank partners by choosing the partner with the lowest pre-configured transport distance value from the batch's store location.
5. IF no food bank partner with `isActive = true` exists in the configured list, THEN THE Donation_Router SHALL return an error indicating no active recipient is configured and SHALL NOT generate a `DonationManifest`.
6. THE Donation_Router SHALL NOT generate a `DonationManifest` for a batch with `effectiveDte` greater than or equal to 0.5 days AND `sellThroughProbability` greater than or equal to 0.05 (no premature donation invariant).

---

### Requirement 7: IRS Section 170(e)(3) Fair Market Tax Deduction Valuation

**User Story:** As a finance controller, I want the system to compute IRS Section 170(e)(3)-compliant charitable deduction amounts for every donation manifest, so that the retailer can claim the maximum allowable tax benefit without manual valuation work.

#### Acceptance Criteria

1. WHEN the Tax_Valuator receives a `DonationManifest` with `donatedQuantityUnits` greater than 0 and valid `fairMarketValuePerUnit`, `costBasisTotal`, and `donatedQuantityUnits`, THE Tax_Valuator SHALL compute `irsDeductionAmount = costBasisTotal + 0.5 × (totalFairMarketValue − costBasisTotal)`.
2. WHEN the computed `irsDeductionAmount` exceeds `2 × costBasisTotal`, THE Tax_Valuator SHALL cap `irsDeductionAmount` at `2 × costBasisTotal` per IRS Section 170(e)(3) limits.
3. WHEN `totalFairMarketValue` is less than or equal to `costBasisTotal`, THE Tax_Valuator SHALL set `irsDeductionAmount` equal to `costBasisTotal` (no deduction below cost basis).
4. THE Tax_Valuator SHALL set `irsFormReference` to `'IRS Form 8283, Section A'` for donations with `totalFairMarketValue` less than 500 USD, and to `'IRS Form 8283, Section B'` for donations with `totalFairMarketValue` of 500 USD or greater.
5. THE Tax_Valuator SHALL ensure that for all valid inputs the `irsDeductionAmount` satisfies `costBasisTotal ≤ irsDeductionAmount ≤ 2 × costBasisTotal` (IRS deduction bounds invariant).
6. IF `donatedQuantityUnits` is zero or negative, THEN THE Tax_Valuator SHALL reject the input and return a descriptive validation error specifying that quantity must be a positive integer.

---

### Requirement 8: Strict Price Invariant Boundedness

**User Story:** As a finance controller, I want every computed retail price to be strictly bounded between the product's cost basis and its MSRP, so that the system never sells a product at a loss or above the advertised price.

#### Acceptance Criteria

1. IF the `tier` on a `PricingDecision` is any value other than `DONATION`, THEN THE Pricing_Engine SHALL ensure `computedPricePerUnit` satisfies `costBasisPerUnit ≤ computedPricePerUnit ≤ msrpPerUnit` before the decision is returned.
2. WHEN the discount computation produces a `computedPricePerUnit` below `costBasisPerUnit`, THE Pricing_Engine SHALL clamp the price to `costBasisPerUnit` and set `boundednessVerified = true`.
3. WHEN the discount computation produces a `computedPricePerUnit` above `msrpPerUnit`, THE Pricing_Engine SHALL clamp the price to `msrpPerUnit` and set `boundednessVerified = true`.
4. IF `costBasisPerUnit` is greater than or equal to `msrpPerUnit`, THEN THE Pricing_Engine SHALL reject the batch input and return a descriptive validation error indicating the invalid cost/MSRP relationship.
5. WHEN the `tier` on a `PricingDecision` is any value other than `DONATION` and `costBasisPerUnit ≤ computedPricePerUnit ≤ msrpPerUnit` holds after clamping, THE Pricing_Engine SHALL set `boundednessVerified = true`.
6. THE Pricing_Engine SHALL ensure that for all valid `PerishableBatch` inputs with `costBasisPerUnit < msrpPerUnit` evaluated at any non-DONATION tier, the resulting `PricingDecision` has `boundednessVerified = true` (universal boundedness invariant).
7. WHEN the `tier` on a `PricingDecision` is `DONATION`, THE Pricing_Engine SHALL set `boundednessVerified = false` and `computedPricePerUnit` to `null`.

---

### Requirement 9: Audit Trail Logging in SQLite Ledger

**User Story:** As a compliance officer, I want every pricing decision and donation event to be recorded in an immutable audit log, so that the retailer can reconstruct the full decision history for regulatory review or dispute resolution.

#### Acceptance Criteria

1. WHEN the Audit_Ledger receives a `PricingDecision`, THE Audit_Ledger SHALL insert an `AuditEntry` record with `entryType = 'PRICING_DECISION'`, `occurredAtIso` set to the current UTC instant in ISO 8601 format, and the full `PricingDecision` serialised as the `payload` within 500 milliseconds of receipt.
2. WHEN the Audit_Ledger receives a `DonationManifest`, THE Audit_Ledger SHALL insert an `AuditEntry` record with `entryType = 'DONATION_MANIFEST'`, `occurredAtIso` set to the current UTC instant, and the full `DonationManifest` serialised as the `payload` within 500 milliseconds of receipt.
3. WHEN the Audit_Ledger receives a `WeatherSyncRecord`, THE Audit_Ledger SHALL insert an `AuditEntry` record with `entryType = 'WEATHER_SYNC'`, `occurredAtIso` set to the current UTC instant, and the full `WeatherSyncRecord` serialised as the `payload` within 500 milliseconds of receipt.
4. THE Audit_Ledger SHALL assign a globally unique `entryId` (UUID v4) to every `AuditEntry` at insert time.
5. IF an insert operation to the SQLite database fails, THEN THE Audit_Ledger SHALL retry the insert up to 3 times with exponential back-off starting at 100 ms and capped at 1600 ms per interval, and SHALL return an error of the form `AuditLedgerInsertError: failed after 3 retries` if all retries are exhausted.
6. THE Audit_Ledger SHALL expose a `queryEntries(batchId: string): AuditEntry[]` function that returns all audit entries for a given `batchId` in ascending `occurredAtIso` order, and returns an empty array when no entries match.
7. IF `batchId` passed to `queryEntries` is null, undefined, or an empty string, THEN THE Audit_Ledger SHALL return an empty array without executing a database query.
8. THE Audit_Ledger SHALL NOT delete or modify existing `AuditEntry` records once inserted (append-only invariant).

---

### Requirement 10: Real-Time Open-Meteo Weather Synchronisation via MCP

**User Story:** As a store operations manager, I want the system to automatically fetch current and forecast ambient temperatures for each store location from Open-Meteo, so that thermal decay calculations use accurate real-world data without manual data entry.

#### Acceptance Criteria

1. WHEN the Weather_Sync component is triggered for a given `storeId` with valid latitude and longitude, THE Weather_Sync SHALL call the Open-Meteo MCP tool with the store's configured latitude and longitude and retrieve hourly temperature data for a 48-hour forecast horizon.
2. WHEN the Open-Meteo MCP returns a successful response, THE Weather_Sync SHALL transform the response into a `WeatherSyncRecord` and pass it to the Audit_Ledger for persistence.
3. WHEN a Weather_Sync cycle completes (whether from a live MCP response or a cache fallback), THE Weather_Sync SHALL make the resulting `TemperatureReading[]` available to the Thermal_Calculator for all active batches at that `storeId`.
4. IF the Open-Meteo MCP call fails or returns a non-200 status, THEN THE Weather_Sync SHALL retry up to 2 times with a 30-second interval and, if all retries fail, SHALL use the most recently cached `WeatherSyncRecord` for that `storeId` with a `fetchedAtIso` no older than 24 hours.
5. IF no valid cached `WeatherSyncRecord` exists (no cache or cache older than 24 hours) when all MCP retries are exhausted, THEN THE Weather_Sync SHALL emit a failure event and THE Pricing_Engine SHALL suspend evaluation for all batches at that `storeId` until a successful sync completes.
6. THE Weather_Sync SHALL execute a synchronisation cycle for each configured store at a maximum interval of 60 minutes.
7. IF a `storeId` has a missing, null, or out-of-range latitude or longitude (latitude outside −90 to 90, longitude outside −180 to 180), THEN THE Weather_Sync SHALL skip the sync cycle for that store and emit a configuration error event identifying the offending `storeId` and field names.
8. WHEN cached temperature data is used due to MCP unavailability, THE Pricing_Engine SHALL include a `rationale` note stating that the pricing decision was based on cached weather data and recording the `fetchedAtIso` of the cache record used.

---

## Phased Implementation Plan

### Phase 1 — Functional Core: Thermal & Shelf-Life Calculators
*Pure TypeScript functions, no I/O. Full property-based test coverage with fast-check.*

- [ ] 1.1 Define all TypeScript interfaces from the Data Models section in `lib/types.ts`
- [ ] 1.2 Implement `computeThermalDecayFactor(history: TemperatureReading[], factors: ThermalDecayFactors): number` in `lib/core/thermalCalculator.ts`
- [ ] 1.3 Implement Q10 simplified path in Thermal_Calculator with coefficient validation
- [ ] 1.4 Implement `computeEffectiveDte(batch: PerishableBatch, decayFactor: number): number` in `lib/core/shelfLifeCalculator.ts`
- [ ] 1.5 Implement `computeSellThroughProbability(effectiveDte: number, velocity: number, qty: number): number`
- [ ] 1.6 Write property-based tests (fast-check) for Req 1 monotonicity invariant
- [ ] 1.7 Write property-based tests (fast-check) for Req 2 inverse monotonicity invariant
- [ ] 1.8 Write property-based tests for temperature boundary validation (< −30, > 60)
- [ ] 1.9 Write round-trip tests: encode batch → decode → recompute → same result
- [ ] 1.10 Run `npm test` and confirm all Phase 1 tests pass

---

### Phase 2 — Functional Core: Pricing Engine
*Pure functions for tier assignment, discount computation, and price clamping.*

- [ ] 2.1 Implement `evaluatePricingTier(effectiveDte: number, sellThroughProb: number): MarkdownTier` in `lib/core/pricingEngine.ts`
- [ ] 2.2 Implement `computeDiscountedPrice(msrp: number, discountRate: number, salvageFloor: number): number` with clamping logic
- [ ] 2.3 Implement `buildPricingDecision(batch: PerishableBatch, effectiveDte: number, sellThroughProb: number): PricingDecision`
- [ ] 2.4 Implement tier precedence enforcement (DONATION > TIER_3 > TIER_2 > TIER_1 > NONE)
- [ ] 2.5 Write property-based tests for Req 8 universal price boundedness invariant
- [ ] 2.6 Write property-based tests for tier escalation (Req 4 escalation invariant)
- [ ] 2.7 Write property-based tests verifying `boundednessVerified = true` for all valid inputs
- [ ] 2.8 Write example-based tests for each tier boundary (DTE = 3.0, 2.0, 1.0, 0.5)
- [ ] 2.9 Write test for invalid cost/MSRP relationship (cost ≥ MSRP returns error)
- [ ] 2.10 Run `npm test` and confirm all Phase 2 tests pass

---

### Phase 3 — Functional Core: Donation Router & Tax Valuator
*Pure functions for donation manifest generation and IRS 170(e)(3) computation.*

- [ ] 3.1 Implement `shouldDonate(effectiveDte: number, sellThroughProb: number): boolean` in `lib/core/donationRouter.ts`
- [ ] 3.2 Implement `buildDonationManifest(batch: PerishableBatch, recipientBank: FoodBank): DonationManifest`
- [ ] 3.3 Implement recipient selection by shortest-distance heuristic (Haversine formula)
- [ ] 3.4 Implement `computeIrsDeduction(manifest: DonationManifest): number` in `lib/core/taxValuator.ts`
- [ ] 3.5 Implement IRS 2× cost-basis cap and form reference assignment
- [ ] 3.6 Write property-based tests for Req 7 IRS deduction bounds invariant (`cost ≤ deduction ≤ 2×cost`)
- [ ] 3.7 Write property-based tests for no-premature-donation invariant (Req 6 criterion 6)
- [ ] 3.8 Write example-based tests for IRS form reference assignment (<$500 vs ≥$500)
- [ ] 3.9 Write test for zero quantity rejection in Tax_Valuator
- [ ] 3.10 Run `npm test` and confirm all Phase 3 tests pass

---

### Phase 4 — Imperative Shell: SQLite Audit Ledger
*Database adapter with retry logic and append-only enforcement.*

- [ ] 4.1 Add `better-sqlite3` dependency and create database schema migration in `lib/db/schema.sql`
- [ ] 4.2 Implement `AuditLedger` class in `lib/db/auditLedger.ts` with `insertEntry`, `queryEntries` methods
- [ ] 4.3 Implement UUID v4 generation for `entryId` using `crypto.randomUUID()`
- [ ] 4.4 Implement exponential back-off retry logic (3 retries, starting at 100 ms) for insert failures
- [ ] 4.5 Enforce append-only constraint: no `UPDATE` or `DELETE` statements in Audit_Ledger
- [ ] 4.6 Write integration tests for `insertEntry` → `queryEntries` round-trip (Req 9)
- [ ] 4.7 Write integration test for retry behaviour on simulated insert failure
- [ ] 4.8 Write integration test verifying records are returned in ascending `occurredAtIso` order
- [ ] 4.9 Run `npm test` and confirm all Phase 4 tests pass

---

### Phase 5 — Imperative Shell: Open-Meteo Weather Sync
*MCP integration adapter with caching and fallback logic.*

- [ ] 5.1 Implement `WeatherSync` class in `lib/shell/weatherSync.ts` wrapping the Open-Meteo MCP tool
- [ ] 5.2 Implement `fetchAndStore(storeId: string): Promise<WeatherSyncRecord>` with MCP call and Audit_Ledger write
- [ ] 5.3 Implement 2-retry logic with 30-second interval for MCP call failures
- [ ] 5.4 Implement cache fallback: on MCP failure, load latest `WeatherSyncRecord` from Audit_Ledger
- [ ] 5.5 Implement 60-minute maximum sync interval guard to avoid excessive MCP calls
- [ ] 5.6 Wire `WeatherSyncRecord` temperature readings into `PerishableBatch.temperatureHistory` for evaluation
- [ ] 5.7 Write integration tests for successful MCP fetch → `WeatherSyncRecord` transform → Audit_Ledger insert
- [ ] 5.8 Write integration test for cache fallback path (Req 10, criterion 4)
- [ ] 5.9 Write test verifying `rationale` note is added to pricing decisions when cached data is used
- [ ] 5.10 Run `npm test` and confirm all Phase 5 tests pass

---

### Phase 6 — Next.js API Routes & UI Dashboard
*Wire functional core and imperative shell into HTTP endpoints and a real-time dashboard.*

- [ ] 6.1 Create `app/api/batches/route.ts` — POST to register a new `PerishableBatch`, GET to list active batches
- [ ] 6.2 Create `app/api/batches/[batchId]/evaluate/route.ts` — POST to trigger a full pricing evaluation cycle
- [ ] 6.3 Create `app/api/donations/route.ts` — GET to list `DonationManifest` records, POST to confirm dispatch
- [ ] 6.4 Create `app/api/audit/route.ts` — GET with `batchId` query param to retrieve audit trail
- [ ] 6.5 Create `app/api/weather/sync/route.ts` — POST to manually trigger a Weather_Sync cycle for a store
- [ ] 6.6 Build dashboard page at `app/dashboard/page.tsx` showing active batches, current tiers, and DTE countdown
- [ ] 6.7 Add real-time tier badge colours: green (NONE), yellow (TIER_1), orange (TIER_2), red (TIER_3), purple (DONATION)
- [ ] 6.8 Build donation manifest list page at `app/donations/page.tsx` with IRS deduction totals
- [ ] 6.9 Add Zod schemas for all API request/response bodies to enforce runtime type safety
- [ ] 6.10 Write end-to-end smoke tests for POST batch → evaluate → check audit trail
- [ ] 6.11 Run `npm run build` and confirm zero TypeScript errors and clean production build
