# Perishable Dynamic Pricing Guidelines

These steering guidelines define the dynamic markdown algorithm, thermal degradation parameters, and price boundary constraints for supermarket perishables.

---

## 1. Temperature Acceleration (Arrhenius Kinetics)

Perishable deterioration accelerates exponentially when ambient or case temperatures exceed standard refrigeration ($4.0^\circ\text{C}$):

$$M(T) = Q_{10}^{(T - 4.0) / 10}$$

### Standard Q10 Sensitivity Constants:
- **Dairy Products**: $Q_{10} = 2.5$
- **Fresh Produce**: $Q_{10} = 2.2$
- **Meat & Poultry**: $Q_{10} = 2.8$
- **Fresh Seafood**: $Q_{10} = 3.0$
- **Bakery & Deli**: $Q_{10} = 2.0$
- **Prepared Foods**: $Q_{10} = 2.4$

---

## 2. Dynamic Markdown Tiers

Discounts are assigned based on effective days to expiration ($DTE_{eff} = DTE_{cal} / M(T)$):

| Tier | Effective DTE Range | Discount % | Objective |
| :--- | :--- | :--- | :--- |
| **Tier 0** | $DTE_{eff} > 5.0$ days | 0% (Full Price) | Standard retail sales velocity |
| **Tier 1** | $3.0 < DTE_{eff} \le 5.0$ days | 15% Discount | Gentle velocity nudge |
| **Tier 2** | $2.0 < DTE_{eff} \le 3.0$ days | 35% Discount | Accelerated clearance |
| **Tier 3** | $1.0 < DTE_{eff} \le 2.0$ days | 55% Discount | Urgent inventory reduction |
| **Tier 4** | $DTE_{eff} \le 1.0$ days ($STP \ge 0.10$) | 70% Clearance | Final markdown opportunity |

---

## 3. Floor Price Protection (P4 Invariant)

To preserve gross margin and brand integrity:
- **Rule**: No markdown price may fall below **30% of the original retail price**:
  $$p_{final} = \max(p_{unconstrained}, 0.30 \times p_{original})$$
- Under no circumstances may a markdown result in negative or zero pricing.
- All pricing decisions must be persisted to the SQLite audit ledger with the exact rule trigger.
