# Charitable Food Donation & IRS § 170(e)(3) Compliance Guidelines

These steering guidelines govern the automatic routing of near-expiry perishables to verified 501(c)(3) food bank entities and the calculation of corporate enhanced charitable deductions.

---

## 1. Routing Criteria

A batch must be automatically routed to donation if and only if:
1. **Critical Expiration**: Effective days to expiration is less than or equal to 1.0 day ($DTE_{eff} \le 1.0$).
2. **Low Sell-Through**: Current sell-through probability is under 10% ($STP < 0.10$).

Under these conditions, retail markdown is statistically unlikely to prevent spoilage, and donation preserves both social utility and corporate tax value.

---

## 2. Qualified Recipient Verification

Donation manifests must only be generated for registered 501(c)(3) entities:
- **Downtown Community Food Bank** (`FB-LA-DOWNTOWN`)
- **Los Angeles Regional Food Bank** (`FB-LA-REGIONAL`)
- **Valley Food Rescue & Distribution** (`FB-LA-VALLEY`)

If a recipient partner is marked `isActive: false`, routing must halt and select the next nearest verified partner.

---

## 3. Financial Calculation & Statutory Dual Ceiling

For every donation manifest:
$$\text{TaxBasis} = \text{costBasisPerUnit} \times \text{quantity}$$
$$\text{FMV} = \text{originalRetailPrice} \times \text{quantity}$$
$$\text{Markup} = \max(0, \text{FMV} - \text{TaxBasis})$$
$$\text{Deduction} = \text{TaxBasis} + \min(0.50 \times \text{Markup}, \text{TaxBasis})$$

### Enforced Invariants:
- $\text{Deduction} \ge \text{TaxBasis}$
- $\text{Deduction} \le 2.0 \times \text{TaxBasis}$
- $\text{Deduction} \le \text{FMV}$

Manifests must include full itemization, food bank certification clauses, and immutable SQLite audit logging.
