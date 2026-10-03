# IRS § 170(e)(3) Inventory Donation Compliance Guide

## 1. Statutory Authority
Under **26 U.S. Code § 170(e)(3)** (Special rule for certain contributions of inventory and other property), C-Corporations (and qualifying pass-through entities under the PATH Act) donating wholesome food inventory to qualified 501(c)(3) public charities for the care of the ill, the needy, or infants are entitled to an **enhanced charitable tax deduction** exceeding traditional cost basis.

---

## 2. The Enhanced Deduction Calculation Formula

Standard non-cash charitable contributions are limited to the taxpayer's cost basis. Under § 170(e)(3), the taxpayer can claim cost basis PLUS up to half the unrealized appreciation, subject to a statutory cap.

### Formal Step-by-Step Calculation:
1. **Determine Tax Basis**:
   $$\text{TaxBasis} = \text{costBasisPerUnit} \times \text{quantity}$$

2. **Determine Fair Market Value (FMV)**:
   $$\text{FMV} = \text{originalRetailPrice} \times \text{quantity}$$

3. **Calculate Unrealized Appreciation (Markup)**:
   $$\text{Appreciation} = \max(0, \text{FMV} - \text{TaxBasis})$$

4. **Calculate Half-Markup Addition**:
   $$\text{HalfMarkup} = 0.50 \times \text{Appreciation}$$

5. **Apply Statutory Ceilings (Dual Limitations)**:
   The deduction is capped by TWO distinct ceilings:
   - **Ceiling 1**: The deduction cannot exceed twice the cost basis ($2 \times \text{TaxBasis}$).
   - **Ceiling 2**: The deduction cannot exceed Fair Market Value ($\text{FMV}$).

### Master Formula:
$$\text{Enhanced Deduction} = \text{TaxBasis} + \min(\text{HalfMarkup}, \text{TaxBasis})$$

Since $\text{TaxBasis} + \text{TaxBasis} = 2 \times \text{TaxBasis}$ and $\text{TaxBasis} + \text{HalfMarkup} \le \text{FMV}$, this master formula naturally respects both statutory constraints.

---

## 3. Statutory Compliance Checklist

To qualify for the enhanced deduction under § 170(e)(3), the following 5 requirements must be satisfied:

1. **Qualified Recipient**:
   - The donee must be a tax-exempt organization under IRC § 501(c)(3).
   - The donee cannot be a private non-operating foundation.
2. **Exclusively for Ill, Needy, or Infants**:
   - The donated food must be used solely for the care of the needy, ill, or infants.
3. **No Commercial Consideration**:
   - The donee organization cannot sell or transfer the donated food in exchange for money, property, or services.
4. **Written Acknowledgment**:
   - The donor must receive written representation from the donee stating compliance with § 170(e)(3)(A)(i)-(iii).
5. **Wholesomeness & Food Safety**:
   - The food must comply with the Federal Food, Drug, and Cosmetic Act (FD&C Act) and applicable state/local health regulations at the time of donation.
   - Protected from civil liability under the **Bill Emerson Good Samaritan Food Donation Act** (42 U.S. Code § 1791).

---

## 4. FreshFlow System Verification

FreshFlow automatically enforces these legal and financial invariants:
- **P6 Invariant Check**: The test suite validates 500 arbitrary input combinations via `fast-check` to mathematically guarantee that $\text{TaxBasis} \le \text{Deduction} \le 2 \times \text{TaxBasis}$ and $\text{Deduction} \le \text{FMV}$ are never violated.
- **Audit Ledger Logging**: Every donation manifest is assigned a unique cryptographic UUID, ISO 8601 UTC timestamp, and locked into the append-only SQLite database.
