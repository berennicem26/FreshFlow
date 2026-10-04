---
inclusion: fileMatch
fileMatchPattern: "lib/**"
---

# FreshFlow Finance & Pricing Rules

These rules apply to all modules under `lib/`. Every pricing, discount, tax valuation, and inventory function **must** conform to the invariants below. Violations are bugs, not edge cases.

---

## 1. Universal Price Boundedness

Every computed retail price **MUST** satisfy:

```
costBasisPerUnit <= computedPricePerUnit <= msrpPerUnit
```

- A product must **never** be sold below its cost basis (salvage floor).
- A product must **never** be sold above its MSRP.
- This invariant applies to every markdown tier (`TIER_1`, `TIER_2`, `TIER_3`) and must be enforced **after** the discount formula is applied, before the price is returned.
- For `DONATION` tier decisions: `computedPricePerUnit` must be `null` and `boundednessVerified` must be `false`.
- If `costBasisPerUnit >= msrpPerUnit`, reject the input immediately with a descriptive validation error.

```typescript
// ❌ Non-Compliant — raw discount applied with no floor/ceiling enforcement
function computeDiscountedPriceBad(msrp: number, discountRate: number): number {
  return msrp * (1 - discountRate); // Can go below cost or above MSRP
}

// ✅ Compliant — salvage floor and MSRP ceiling enforced, result rounded
function computeDiscountedPrice(
  msrp: number,
  discountRate: number,
  salvageFloor: number
): number {
  const raw = msrp * (1 - discountRate);
  const clamped = Math.max(salvageFloor, Math.min(msrp, raw));
  return roundCurrency(clamped);
}
```

---

## 2. Discount Monotonicity

As effective days-to-expiry (DTE) decreases, discount rates **MUST** be monotonically non-decreasing across tiers:

| Tier       | DTE Threshold (effective days left) | Discount Rate |
|------------|-------------------------------------|---------------|
| `NONE`     | DTE > 5.0, or DTE ≤ 5.0 with STP ≥ 0.9 | 0%         |
| `TIER_1`   | DTE ≤ 5.0 + STP < 0.9               | 15%           |
| `TIER_2`   | DTE ≤ 4.0                           | 35%           |
| `TIER_3`   | DTE ≤ 3.0                           | 50%           |
| `DONATION` | 1.0 ≤ DTE ≤ 2.0, or DTE ≤ 3.0 + STP < 0.5 | N/A     |
| `PULL`     | DTE < 1.0                           | N/A (removed from sale) |

All thresholds live in `lib/core/retailPolicy.ts` — never hard-code them elsewhere.

**Why these numbers (real-world grounding):** supermarkets mark down 1–5 days before the date; food banks need usable shelf-life on arrival (produce ≥ 5 days, cut produce ≥ 3 days), so donation must happen while ≥ 1 day remains for pickup and distribution; shoppers need ≥ 2 days to use discounted stock at home.

**Tier precedence** (descending urgency): `PULL > DONATION > TIER_3 > TIER_2 > TIER_1 > NONE`

A higher-urgency tier always supersedes a lower-urgency tier. Evaluate conditions from highest to lowest urgency and return on the first match — exactly one tier per `PricingDecision`.

```typescript
// ❌ Non-Compliant — tiers evaluated bottom-up, lower tier can override higher
function evaluateTierBad(dte: number, stp: number): MarkdownTier {
  if (dte <= 5.0 && stp < 0.9) return 'TIER_1';
  if (dte <= 4.0) return 'TIER_2'; // Never reached when dte <= 5.0 already matched
  if (dte <= 3.0) return 'TIER_3';
  return 'NONE';
}

// ✅ Compliant — highest urgency evaluated first, first match wins
function evaluatePricingTier(dte: number, stp: number): MarkdownTier {
  if (dte < 1.0)                return 'PULL';
  if (dte <= 2.0)               return 'DONATION';
  if (dte <= 3.0 && stp < 0.5)  return 'DONATION';
  if (dte <= 3.0)               return 'TIER_3';
  if (dte <= 4.0)               return 'TIER_2';
  if (dte <= 5.0 && stp < 0.9)  return 'TIER_1';
  return 'NONE';
}
```

---

## 3. Currency & Rounding Standards

All monetary amounts are **USD**, rounded to exactly **2 decimal places** using the standard financial round-half-up method:

```typescript
// ✅ Required rounding utility — use for every monetary output
function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
```

**Rules:**
- Apply `roundCurrency` to every computed price **before** storing or returning it.
- Never return raw floating-point results for monetary fields (e.g., `$3.4900000000000002` is a violation).
- Apply rounding **after** clamping, not before — clamp on the raw value, then round.
- `Number.EPSILON` guards against IEEE 754 representation errors at the rounding boundary (e.g., `0.1 + 0.2`).

```typescript
// ❌ Non-Compliant — floating-point precision leaks into price output
const price = 4.99 * 0.85; // → 4.2415000000000005

// ✅ Compliant — rounded to valid currency representation
const price = roundCurrency(4.99 * 0.85); // → 4.24
```

---

## 4. Quantity & Velocity Guardrails

Before any shelf-life or pricing computation, validate:

| Field                | Constraint                     | Error message                                      |
|----------------------|--------------------------------|----------------------------------------------------|
| `quantityOnHand`     | Must be a positive integer > 0 | `"quantityOnHand must be greater than zero"`       |
| `dailySalesVelocity` | Must be non-negative (≥ 0)     | `"dailySalesVelocity must be non-negative"`        |
| `costBasisPerUnit`   | Must be > 0                    | `"costBasisPerUnit must be positive"`              |
| `msrpPerUnit`        | Must be > `costBasisPerUnit`   | `"costBasisPerUnit must be strictly less than msrpPerUnit"` |

All validation failures **must** return a `{ ok: false, error: string }` discriminated union — never throw for domain validation errors in the Functional Core.

```typescript
// ✅ Compliant validation guard
function validateBatchInputs(
  quantityOnHand: number,
  dailySalesVelocity: number,
  costBasisPerUnit: number,
  msrpPerUnit: number
): { ok: true } | { ok: false; error: string } {
  if (quantityOnHand <= 0)
    return { ok: false, error: 'quantityOnHand must be greater than zero' };
  if (dailySalesVelocity < 0)
    return { ok: false, error: 'dailySalesVelocity must be non-negative' };
  if (costBasisPerUnit <= 0)
    return { ok: false, error: 'costBasisPerUnit must be positive' };
  if (costBasisPerUnit >= msrpPerUnit)
    return { ok: false, error: 'costBasisPerUnit must be strictly less than msrpPerUnit' };
  return { ok: true };
}
```

---

## 5. IRS Section 170(e)(3) Deduction Formula

The charitable deduction amount for food bank donations is governed by IRS Section 170(e)(3). The formula and constraints below are **legally binding** — deviations create tax liability exposure.

### Formula

```
deductionAmount = costBasisTotal + 0.5 × (totalFairMarketValue − costBasisTotal)
```

### Constraints

| Case                                       | Result                                         |
|--------------------------------------------|------------------------------------------------|
| `totalFairMarketValue <= costBasisTotal`    | `deductionAmount = costBasisTotal` (floor)     |
| `deductionAmount > 2 × costBasisTotal`     | `deductionAmount = 2 × costBasisTotal` (cap)   |
| All valid inputs                           | `costBasisTotal ≤ deductionAmount ≤ 2 × costBasisTotal` |

```typescript
// ❌ Non-Compliant — missing floor and missing 2× cap
function computeIrsDeductionBad(
  totalFairMarketValue: number,
  costBasisTotal: number
): number {
  return costBasisTotal + 0.5 * (totalFairMarketValue - costBasisTotal);
  // Can return less than costBasisTotal if FMV < cost
  // Can exceed 2× costBasisTotal if FMV is very high
}

// ✅ Compliant — floor, formula, and 2× cap applied in order
function computeIrsDeduction(
  totalFairMarketValue: number,
  costBasisTotal: number
): number {
  // Floor: deduction cannot be less than cost basis
  if (totalFairMarketValue <= costBasisTotal) {
    return roundCurrency(costBasisTotal);
  }

  const base = costBasisTotal + 0.5 * (totalFairMarketValue - costBasisTotal);
  const cap  = 2 * costBasisTotal;

  // Cap: deduction cannot exceed 2× cost basis (IRS 170(e)(3))
  return roundCurrency(Math.min(base, cap));
}
```

---

## 6. Tax Form Reference Assignment

The IRS form reference must be assigned based on `totalFairMarketValue` at the time the `DonationManifest` is generated:

| Total FMV         | `irsFormReference`            |
|-------------------|-------------------------------|
| FMV < $500        | `'IRS Form 8283, Section A'`  |
| FMV ≥ $500        | `'IRS Form 8283, Section B'`  |

```typescript
// ✅ Compliant form reference assignment
function assignIrsFormReference(totalFairMarketValue: number): string {
  return totalFairMarketValue < 500
    ? 'IRS Form 8283, Section A'
    : 'IRS Form 8283, Section B';
}
```

The threshold is **exactly $500.00** — `totalFairMarketValue = 500.00` assigns Section B. Apply `roundCurrency` to `totalFairMarketValue` before this comparison to prevent floating-point boundary errors.

---

## 7. Error Handling Contract (Functional Core)

All functions in `lib/core/**` **must** return a discriminated union — never throw for domain errors:

```typescript
type Result<T> =
  | { ok: true;  value: T }
  | { ok: false; error: string };
```

The Imperative Shell (`lib/db/**`, `lib/shell/**`) may throw named error classes (`AuditLedgerInsertError`, `WeatherSyncError`) for infrastructure failures only.

---

## Quick Reference Checklist

Before submitting any pricing or tax function in `lib/`:

- [ ] `computedPricePerUnit` is clamped to `[costBasisPerUnit, msrpPerUnit]`
- [ ] All monetary outputs pass through `roundCurrency()`
- [ ] Tier assignment evaluates highest urgency first
- [ ] IRS deduction applies floor, formula, and 2× cap in order
- [ ] `irsFormReference` uses `< 500` / `>= 500` boundary
- [ ] `quantityOnHand > 0` and `dailySalesVelocity >= 0` are validated before any computation
- [ ] Domain errors return `{ ok: false, error: string }` — never throw
