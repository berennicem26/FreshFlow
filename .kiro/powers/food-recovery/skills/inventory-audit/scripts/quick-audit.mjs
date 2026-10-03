#!/usr/bin/env node
/**
 * powers/food-recovery/skills/inventory-audit/scripts/quick-audit.mjs
 *
 * Standalone automation script to audit perishable supermarket inventory,
 * recalculate thermal decay based on store ambient temperatures,
 * determine dynamic markdown tiers or 501(c)(3) donation routing,
 * and calculate IRS § 170(e)(3) corporate tax deductions.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Category Q10 coefficients
const Q10_MAP = {
  Dairy: 2.5,
  Produce: 2.2,
  Meat: 2.8,
  Seafood: 3.0,
  Bakery: 2.0,
  Prepared: 2.4,
};

// Markdown Tiers
const MARKDOWN_TIERS = [
  { tier: 0, discount: 0.00, label: 'Full Price' },
  { tier: 1, discount: 0.15, label: '15% Markdown' },
  { tier: 2, discount: 0.35, label: '35% Markdown' },
  { tier: 3, discount: 0.55, label: '55% Markdown' },
  { tier: 4, discount: 0.70, label: '70% Clearance' },
];

// Reference grocery inventory
const SEED_BATCHES = [
  {
    id: 'BATCH-DAIRY-001',
    productName: 'Organic Whole Milk 1 Gal',
    category: 'Dairy',
    costBasis: 2.10,
    originalPrice: 4.99,
    quantity: 45,
    daysToExpiration: 2.5,
    salesVelocity: 12.0, // units/day
  },
  {
    id: 'BATCH-PRODUCE-002',
    productName: 'Baby Spinach 16oz Clamshell',
    category: 'Produce',
    costBasis: 1.40,
    originalPrice: 3.49,
    quantity: 28,
    daysToExpiration: 1.8,
    salesVelocity: 8.0,
  },
  {
    id: 'BATCH-MEAT-003',
    productName: 'USDA Choice Ribeye Steak',
    category: 'Meat',
    costBasis: 8.50,
    originalPrice: 16.99,
    quantity: 14,
    daysToExpiration: 1.2,
    salesVelocity: 3.0,
  },
  {
    id: 'BATCH-SEAFOOD-004',
    productName: 'Wild Atlantic Salmon Fillet',
    category: 'Seafood',
    costBasis: 7.20,
    originalPrice: 14.50,
    quantity: 18,
    daysToExpiration: 0.8,
    salesVelocity: 2.0,
  },
  {
    id: 'BATCH-BAKERY-005',
    productName: 'Artisan Sourdough Loaf',
    category: 'Bakery',
    costBasis: 1.10,
    originalPrice: 4.25,
    quantity: 22,
    daysToExpiration: 1.5,
    salesVelocity: 6.0,
  },
  {
    id: 'BATCH-PREPARED-006',
    productName: 'Rotisserie Chicken',
    category: 'Prepared',
    costBasis: 3.00,
    originalPrice: 7.99,
    quantity: 8,
    daysToExpiration: 0.4,
    salesVelocity: 1.5,
  },
];

function calculateThermalMultiplier(category, ambientTempC) {
  const q10 = Q10_MAP[category] || 2.2;
  const tempDelta = Math.max(0, ambientTempC - 4.0);
  return Math.pow(q10, tempDelta / 10.0);
}

function calculateIRS170e3Deduction(costBasis, fmv, quantity) {
  const totalCost = costBasis * quantity;
  const totalFmv = fmv * quantity;
  const markup = Math.max(0, totalFmv - totalCost);
  const halfMarkup = 0.5 * markup;
  const additionalDeduction = Math.min(halfMarkup, totalCost);
  const deduction = totalCost + additionalDeduction;

  return {
    totalCost: Number(totalCost.toFixed(2)),
    totalFmv: Number(totalFmv.toFixed(2)),
    markup: Number(markup.toFixed(2)),
    halfMarkup: Number(halfMarkup.toFixed(2)),
    deduction: Number(deduction.toFixed(2)),
    taxSavingsAt21Pct: Number((deduction * 0.21).toFixed(2)),
  };
}

export function runQuickAudit(ambientTempC = 24.5) {
  console.log('='.repeat(78));
  console.log(` FRESHFLOW FOOD RECOVERY & INVENTORY AUDIT`);
  console.log(` Store Ambient Temperature: ${ambientTempC.toFixed(1)}°C (Refrig Ref: 4.0°C)`);
  console.log('='.repeat(78));

  const results = {
    timestamp: new Date().toISOString(),
    ambientTempC,
    totalBatches: SEED_BATCHES.length,
    markdownCandidates: [],
    donationCandidates: [],
    totalDeductionPotential: 0,
    totalTaxSavings: 0,
  };

  for (const batch of SEED_BATCHES) {
    const thermalMultiplier = calculateThermalMultiplier(batch.category, ambientTempC);
    const effectiveDte = batch.daysToExpiration / thermalMultiplier;
    const sellThroughProb = Math.min(1.0, (batch.salesVelocity * effectiveDte) / batch.quantity);

    if (effectiveDte <= 1.0 && sellThroughProb < 0.10) {
      // Critical expiration & low velocity -> 501(c)(3) Donation
      const tax = calculateIRS170e3Deduction(batch.costBasis, batch.originalPrice, batch.quantity);
      results.donationCandidates.push({
        batchId: batch.id,
        productName: batch.productName,
        category: batch.category,
        quantity: batch.quantity,
        effectiveDte: Number(effectiveDte.toFixed(2)),
        taxDeduction: tax.deduction,
        taxSavings: tax.taxSavingsAt21Pct,
        targetFoodBank: 'Los Angeles Regional Food Bank (501(c)(3) EIN: 95-3129841)',
      });
      results.totalDeductionPotential += tax.deduction;
      results.totalTaxSavings += tax.taxSavingsAt21Pct;
    } else {
      // Dynamic Markdown
      let tierIndex = 0;
      if (effectiveDte <= 1.0) tierIndex = 4;
      else if (effectiveDte <= 2.0) tierIndex = 3;
      else if (effectiveDte <= 3.0) tierIndex = 2;
      else if (effectiveDte <= 5.0) tierIndex = 1;

      const tier = MARKDOWN_TIERS[tierIndex];
      const unconstrainedPrice = batch.originalPrice * (1 - tier.discount);
      const floorPrice = 0.30 * batch.originalPrice;
      const finalPrice = Math.max(floorPrice, unconstrainedPrice);

      results.markdownCandidates.push({
        batchId: batch.id,
        productName: batch.productName,
        category: batch.category,
        quantity: batch.quantity,
        effectiveDte: Number(effectiveDte.toFixed(2)),
        thermalMultiplier: Number(thermalMultiplier.toFixed(2)),
        tier: tier.tier,
        discountPct: `${(tier.discount * 100).toFixed(0)}%`,
        originalPrice: batch.originalPrice,
        markdownPrice: Number(finalPrice.toFixed(2)),
        floorProtected: finalPrice > unconstrainedPrice,
      });
    }
  }

  // Summary Printing
  console.log('\n[DYNAMIC MARKDOWN RECOMMENDATIONS]');
  console.table(
    results.markdownCandidates.map((m) => ({
      Batch: m.batchId,
      Product: m.productName,
      'Eff DTE': `${m.effectiveDte}d`,
      Decay: `${m.thermalMultiplier}x`,
      Tier: m.tier,
      Discount: m.discountPct,
      'Orig Price': `$${m.originalPrice.toFixed(2)}`,
      'New Price': `$${m.markdownPrice.toFixed(2)}`,
    }))
  );

  console.log('\n[501(c)(3) DONATION RECOVERY & IRS § 170(e)(3) MANIFESTS]');
  console.table(
    results.donationCandidates.map((d) => ({
      Batch: d.batchId,
      Product: d.productName,
      Qty: d.quantity,
      'Eff DTE': `${d.effectiveDte}d`,
      '§ 170(e)(3) Deduction': `$${d.taxDeduction.toFixed(2)}`,
      'Corporate Tax Savings': `$${d.taxSavings.toFixed(2)}`,
      Recipient: 'LA Regional Food Bank',
    }))
  );

  console.log('='.repeat(78));
  console.log(` AUDIT SUMMARY:`);
  console.log(` - Batches for Dynamic Markdown: ${results.markdownCandidates.length}`);
  console.log(` - Batches Routed to 501(c)(3) Donation: ${results.donationCandidates.length}`);
  console.log(` - Total Enhanced Tax Deduction: $${results.totalDeductionPotential.toFixed(2)}`);
  console.log(` - Estimated Corporate Tax Benefit (21%): $${results.totalTaxSavings.toFixed(2)}`);
  console.log('='.repeat(78));

  return results;
}

// Auto-run if invoked directly
const ambientArg = process.argv[2] ? parseFloat(process.argv[2]) : 24.5;
runQuickAudit(ambientArg);
