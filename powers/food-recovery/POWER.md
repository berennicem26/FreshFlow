---
name: food-recovery
displayName: FreshFlow Food Recovery & Dynamic Markdown
description: Intelligent perishables spoilage prevention, dynamic markdown pricing, and IRS §170(e)(3) donation recovery
keywords:
  - food recovery
  - spoilage
  - markdown pricing
  - food donation
  - shelf life
  - irs 170e3
  - tax deduction
  - perishables
  - thermal decay
  - inventory audit
---

# FreshFlow Food Recovery & Dynamic Markdown Power

The **Food Recovery Power** provides Kiro agents with specialized domain intelligence, mathematical decay models, strict financial invariants, and automated audit tools for supermarket perishables management.

---

## 1. Purpose & Scope

This power equips agents to:
1. **Model Perishable Degradation**: Dynamically compute thermal decay multipliers using the Arrhenius kinetic rate equations ($k = k_0 \cdot Q_{10}^{(T - T_{ref}) / 10}$).
2. **Execute Dynamic Markdowns**: Safely calculate Tier 0 (0%), Tier 1 (15%), Tier 2 (35%), Tier 3 (55%), and Tier 4 (70%) markdown prices while enforcing a strict **30% original price floor**.
3. **Automate Food Bank Routing**: Transition batches nearing expiration ($\le 1.0$ day effective shelf-life and low sell-through probability) to verified 501(c)(3) food banks.
4. **Enforce IRS § 170(e)(3) Compliance**: Accurately calculate the enhanced corporate deduction under the dual ceiling formula:
   $$\text{Deduction} = \text{TaxBasis} + \min(0.5 \times (\text{FMV} - \text{TaxBasis}), \text{TaxBasis})$$
5. **Maintain Immutable Audit Trails**: Persist all evaluation decisions and weather sync logs to an append-only SQLite ledger protected by database-level triggers.

---

## 2. Activation Signals

This power activates automatically when the user or prompt mentions:
- Perishable goods, shelf-life, expiration dates, or spoilage.
- Dynamic markdown, discounting, or clearance pricing.
- Heatwaves, ambient store temperature spikes, or cold-chain breaches.
- Food donations, food bank routing, or charitable contributions.
- IRS § 170(e)(3) tax deductions or inventory write-offs.
- Supermarket inventory audits.

---

## 3. Strict Invariant Guardrails

When this power is active, agents **MUST** enforce the following 8 fundamental system invariants:

- **P1 — Non-Negative Decay Multiplier**: Thermal decay rate $k \ge 1.0$ for temperatures at or above reference ($T_{ref} = 4^\circ\text{C}$).
- **P2 — Monotonic Temperature Sensitivity**: Decay multiplier $M(T_2) \ge M(T_1)$ whenever $T_2 \ge T_1$.
- **P3 — Shelf-Life Upper Bound**: Effective shelf-life $\le$ nominal calendar days to expiration.
- **P4 — Pricing Floor Invariant**: Markdown price $\ge 30\%$ of original price ($p_{markdown} \ge 0.30 \times p_{original}$), strictly prohibiting negative or zero pricing.
- **P5 — Monotonic Tier Discounts**: Markdown discount percentages monotonically increase with urgency: Tier 0 (0%) < Tier 1 (15%) < Tier 2 (35%) < Tier 3 (55%) < Tier 4 (70%).
- **P6 — § 170(e)(3) Dual Ceiling Invariant**: Deduction is strictly bounded by:
  $$\text{TaxBasis} \le \text{Deduction} \le 2 \times \text{TaxBasis} \quad \text{and} \quad \text{Deduction} \le \text{FMV}$$
- **P7 — Registered Recipient Validation**: Donations must route exclusively to active 501(c)(3) food bank entities.
- **P8 — Append-Only Audit Integrity**: All pricing decisions, donation manifests, and weather syncs must be logged to the SQLite audit table. No `UPDATE` or `DELETE` statements are permitted.

---

## 4. Golden Path Execution

When handling perishables inventory:

1. **Inspect Batch**: Query batch properties (category, original price, cost basis, expiration date, storage location).
2. **Fetch Ambient/Storage Conditions**: Obtain current temperature readings via Open-Meteo or internal sensors.
3. **Calculate Effective Days to Expiration ($DTE_{eff}$)**:
   $$DTE_{eff} = \frac{DTE_{calendar}}{M(T)}$$
4. **Determine Action**:
   - If $DTE_{eff} > 1.0$ or $STP \ge 0.10$: Apply dynamic markdown tier.
   - If $DTE_{eff} \le 1.0$ and $STP < 0.10$: Route to 501(c)(3) donation and generate IRS § 170(e)(3) certified manifest.
5. **Log to SQLite Ledger**: Persist the audit entry with cryptographic timestamp and payload.

---

## 5. Steering File Mappings

Detailed operational guidelines are mapped to specialized steering documents:

| Topic | Steering File | Scope |
| :--- | :--- | :--- |
| **Pricing Rules** | `steering/perishable-pricing-guidelines.md` | Kinetic equations, Q10 factors, markdown tiers, floor protections |
| **Donation Rules** | `steering/donation-compliance.md` | § 170(e)(3) calculations, 501(c)(3) verification, certified manifests |

---

## 6. Bundled Skills & Automation Tools

- **Skill**: `skills/inventory-audit/`
  - Step-by-step agent instructions for auditing batches, identifying at-risk inventory, and issuing markdown schedules.
- **Audit Script**: `skills/inventory-audit/scripts/quick-audit.mjs`
  - CLI tool to rapidly audit database batches and print markdown/donation summaries.
- **Compliance Reference**: `skills/inventory-audit/references/irs-170e3-guide.md`
  - Complete statutory reference for corporate food donations.
