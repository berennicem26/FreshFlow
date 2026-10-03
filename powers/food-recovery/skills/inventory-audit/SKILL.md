---
name: inventory-audit
description: Automated perishables spoilage audit, thermal degradation recalculation, markdown tier scheduling, and IRS §170(e)(3) tax deduction manifest generation.
---

# Inventory Spoilage & Recovery Audit Skill

This skill guides the AI agent through executing an end-to-end perishable inventory evaluation, recalculating shelf-life degradation under current ambient temperatures, assigning optimal markdown tiers, and routing critical items to certified 501(c)(3) food banks with IRS § 170(e)(3) enhanced deduction calculations.

---

## Prerequisites

Before executing this skill:
1. Ensure the SQLite audit ledger database is initialized (`data/freshflow.db`).
2. Verify that perishable batches are accessible via the batch store or API endpoints.
3. Verify that the ambient temperature service (`WeatherSync`) or local temperature telemetry is reachable.

---

## Step 1: Inventory Discovery & Ambient Temperature Fetch

1. Retrieve active perishable batches across all departments (Dairy, Produce, Meat, Seafood, Bakery, Prepared Foods).
2. Fetch the latest store ambient temperature:
   - For LA Supermarket 101: coordinate `34.0522, -118.2437`.
   - Query the Open-Meteo endpoint or local sensor cache.
   - If a heatwave is active ($T > 25^\circ\text{C}$), note the thermal acceleration hazard.

---

## Step 2: Thermal Decay & Shelf-Life Calculation

For each batch:
1. Calculate nominal calendar days to expiration ($DTE_{cal} = \text{expirationDate} - \text{now}$).
2. Compute the category-specific thermal multiplier:
   $$M(T) = Q_{10}^{(T - T_{ref}) / 10}$$
   Where $T_{ref} = 4.0^\circ\text{C}$ (refrigerated reference temperature) and $Q_{10}$ is category-dependent:
   - Dairy: $Q_{10} = 2.5$
   - Produce: $Q_{10} = 2.2$
   - Meat & Poultry: $Q_{10} = 2.8$
   - Seafood: $Q_{10} = 3.0$
   - Bakery / Deli: $Q_{10} = 2.0$
3. Compute the effective shelf-life:
   $$DTE_{eff} = \frac{DTE_{cal}}{M(T)}$$

---

## Step 3: Markdown Evaluation vs. Donation Thresholds

1. Calculate Sell-Through Probability ($STP$):
   $$STP = \text{velocity} \times \frac{DTE_{eff}}{\text{currentStock}}$$
2. Determine decision branch:
   - **Branch A — Dynamic Markdown**:
     If $DTE_{eff} > 1.0$ or $STP \ge 0.10$:
     - Tier 0 ($DTE_{eff} > 5.0$): 0% discount
     - Tier 1 ($3.0 < DTE_{eff} \le 5.0$): 15% discount
     - Tier 2 ($2.0 < DTE_{eff} \le 3.0$): 35% discount
     - Tier 3 ($1.0 < DTE_{eff} \le 2.0$): 55% discount
     - Tier 4 ($DTE_{eff} \le 1.0$ with $STP \ge 0.10$): 70% discount
     - **Safety Enforcement**: Proposed price must never drop below **30% of original price** ($\max(\text{calculated}, 0.30 \times p_{orig})$).
   - **Branch B — 501(c)(3) Donation Manifest**:
     If $DTE_{eff} \le 1.0$ and $STP < 0.10$:
     - Item has degraded beyond retail viability.
     - Immediately route to an active 501(c)(3) food bank partner (e.g., Downtown Community Food Bank, Regional Food Bank).

---

## Step 4: IRS § 170(e)(3) Enhanced Deduction Computation

For donated batches, compute the exact tax deduction:
1. Input variables:
   - $\text{TaxBasis} = \text{costBasisPerUnit} \times \text{quantity}$
   - $\text{FMV} = \text{originalPricePerUnit} \times \text{quantity}$
2. Markup / Profit Margin:
   $$\text{Markup} = \max(0, \text{FMV} - \text{TaxBasis})$$
3. Half-Markup:
   $$\text{HalfMarkup} = 0.50 \times \text{Markup}$$
4. Dual Ceiling Test:
   $$\text{Deduction} = \text{TaxBasis} + \min(\text{HalfMarkup}, \text{TaxBasis})$$
5. Verify Invariants:
   - $\text{Deduction} \le 2.0 \times \text{TaxBasis}$
   - $\text{Deduction} \le \text{FMV}$
   - $\text{Deduction} \ge \text{TaxBasis}$

---

## Step 5: Immutable Audit Ledger Recording

For every evaluated batch:
1. Format audit payload with batch ID, store ID, current temperature, timestamps, and decision specifics.
2. Insert entry into SQLite `audit_entries` table:
   - Entry types: `PRICING_DECISION` or `DONATION_MANIFEST`.
   - Never attempt `UPDATE` or `DELETE` operations.

---

## Step 6: Output & Verification

Print or return the formatted audit summary including:
- Total batches evaluated.
- Batches repriced (with discount distribution).
- Batches routed to donation.
- Total IRS § 170(e)(3) corporate tax deduction value unlocked.
