#!/usr/bin/env node
/**
 * scripts/mcp-inventory-server.mjs
 *
 * FreshFlow Model Context Protocol (MCP) STDIO Server.
 * Exposes tools for perishable inventory management, Arrhenius thermal decay,
 * dynamic markdown pricing with floor enforcement, and IRS § 170(e)(3) donation routing.
 *
 * Implements the MCP STDIO transport (JSON-RPC 2.0 over standard I/O).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

// Category Q10 coefficients (Arrhenius kinetics)
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

// Seeded batches
const INVENTORY = [
  {
    id: 'BATCH-DAIRY-001',
    productName: 'Organic Whole Milk 1 Gal',
    category: 'Dairy',
    costBasis: 2.10,
    originalPrice: 4.99,
    quantity: 45,
    daysToExpiration: 2.5,
    salesVelocity: 12.0,
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

// Registered 501(c)(3) Food Banks
const FOOD_BANKS = {
  'FB-LA-DOWNTOWN': {
    id: 'FB-LA-DOWNTOWN',
    name: 'Downtown Community Food Bank',
    ein: '95-4819201',
    address: '1240 S San Pedro St, Los Angeles, CA 90015',
  },
  'FB-LA-REGIONAL': {
    id: 'FB-LA-REGIONAL',
    name: 'Los Angeles Regional Food Bank',
    ein: '95-3129841',
    address: '1734 E 41st St, Los Angeles, CA 90058',
  },
  'FB-LA-VALLEY': {
    id: 'FB-LA-VALLEY',
    name: 'Valley Food Rescue & Distribution',
    ein: '95-7728190',
    address: '6851 Van Nuys Blvd, Van Nuys, CA 91405',
  },
};

// Initialize DB if needed
const DB_PATH = process.env.AUDIT_DB_PATH || join(process.cwd(), 'data', 'freshflow.db');
let db = null;

function getDb() {
  if (!db) {
    const dir = join(process.cwd(), 'data');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    const schemaPath = join(process.cwd(), 'lib', 'db', 'schema.sql');
    if (existsSync(schemaPath)) {
      const sql = readFileSync(schemaPath, 'utf8');
      db.exec(sql);
    }
  }
  return db;
}

// Tool Definitions
const TOOLS = [
  {
    name: 'get_perishable_inventory',
    description: 'Retrieve current grocery inventory batches with department categorization, expiration horizons, cost basis, and sales velocity.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by perishable category (Dairy, Produce, Meat, Seafood, Bakery, Prepared)',
          enum: ['Dairy', 'Produce', 'Meat', 'Seafood', 'Bakery', 'Prepared'],
        },
        maxDte: {
          type: 'number',
          description: 'Filter by maximum nominal calendar days to expiration',
        },
      },
    },
  },
  {
    name: 'evaluate_batch_markdown',
    description: 'Evaluate thermal decay kinetics, effective shelf life, sell-through probability, and calculate optimal dynamic markdown tier with 30% price floor protection.',
    inputSchema: {
      type: 'object',
      properties: {
        batchId: {
          type: 'string',
          description: 'Unique identifier of the perishable batch (e.g. BATCH-DAIRY-001)',
        },
        ambientTempC: {
          type: 'number',
          description: 'Store ambient temperature in Celsius (default: 22.0°C)',
        },
      },
      required: ['batchId'],
    },
  },
  {
    name: 'route_donation_manifest',
    description: 'Generate an IRS § 170(e)(3) certified donation manifest for a near-expiry batch, verifying 501(c)(3) food bank eligibility and computing enhanced corporate tax deductions.',
    inputSchema: {
      type: 'object',
      properties: {
        batchId: {
          type: 'string',
          description: 'Unique identifier of the batch to donate',
        },
        foodBankId: {
          type: 'string',
          description: 'Recipient 501(c)(3) partner ID (e.g. FB-LA-REGIONAL, FB-LA-DOWNTOWN)',
          enum: ['FB-LA-DOWNTOWN', 'FB-LA-REGIONAL', 'FB-LA-VALLEY'],
        },
      },
      required: ['batchId'],
    },
  },
  {
    name: 'calculate_arrhenius_decay',
    description: 'Calculate the Arrhenius thermal decay acceleration multiplier and effective shelf-life reduction for a given food category and ambient temperature.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Product department category',
          enum: ['Dairy', 'Produce', 'Meat', 'Seafood', 'Bakery', 'Prepared'],
        },
        ambientTempC: {
          type: 'number',
          description: 'Ambient temperature in Celsius',
        },
        nominalDays: {
          type: 'number',
          description: 'Nominal calendar days to expiration',
        },
      },
      required: ['category', 'ambientTempC', 'nominalDays'],
    },
  },
  {
    name: 'query_audit_trail',
    description: 'Query the immutable SQLite audit ledger for historical pricing decisions, donation manifests, and weather sync events for a batch.',
    inputSchema: {
      type: 'object',
      properties: {
        batchId: {
          type: 'string',
          description: 'Batch ID to inspect in the audit ledger',
        },
      },
      required: ['batchId'],
    },
  },
];

// Tool Implementation Logic
function handleToolCall(name, args) {
  switch (name) {
    case 'get_perishable_inventory': {
      let batches = [...INVENTORY];
      if (args.category) {
        batches = batches.filter((b) => b.category.toLowerCase() === args.category.toLowerCase());
      }
      if (args.maxDte !== undefined) {
        batches = batches.filter((b) => b.daysToExpiration <= args.maxDte);
      }
      return {
        totalBatches: batches.length,
        inventory: batches,
      };
    }

    case 'calculate_arrhenius_decay': {
      const q10 = Q10_MAP[args.category] || 2.2;
      const tempDelta = Math.max(0, args.ambientTempC - 4.0);
      const thermalMultiplier = Math.pow(q10, tempDelta / 10.0);
      const effectiveDays = args.nominalDays / thermalMultiplier;
      return {
        category: args.category,
        q10Sensitivity: q10,
        referenceTempC: 4.0,
        ambientTempC: args.ambientTempC,
        thermalMultiplier: Number(thermalMultiplier.toFixed(3)),
        nominalDays: args.nominalDays,
        effectiveDays: Number(effectiveDays.toFixed(2)),
        decayFactorPercentage: `${((thermalMultiplier - 1) * 100).toFixed(1)}% faster degradation`,
      };
    }

    case 'evaluate_batch_markdown': {
      const batch = INVENTORY.find((b) => b.id === args.batchId);
      if (!batch) {
        throw new Error(`Batch not found: ${args.batchId}`);
      }
      const ambientTempC = args.ambientTempC !== undefined ? args.ambientTempC : 22.0;
      const q10 = Q10_MAP[batch.category] || 2.2;
      const tempDelta = Math.max(0, ambientTempC - 4.0);
      const thermalMultiplier = Math.pow(q10, tempDelta / 10.0);
      const effectiveDte = batch.daysToExpiration / thermalMultiplier;
      const sellThroughProb = Math.min(1.0, (batch.salesVelocity * effectiveDte) / batch.quantity);

      const isCritical = effectiveDte <= 1.0 && sellThroughProb < 0.10;

      let tierIndex = 0;
      if (effectiveDte <= 1.0) tierIndex = 4;
      else if (effectiveDte <= 2.0) tierIndex = 3;
      else if (effectiveDte <= 3.0) tierIndex = 2;
      else if (effectiveDte <= 5.0) tierIndex = 1;

      const tier = MARKDOWN_TIERS[tierIndex];
      const unconstrainedPrice = batch.originalPrice * (1 - tier.discount);
      const floorPrice = 0.30 * batch.originalPrice;
      const finalPrice = Math.max(floorPrice, unconstrainedPrice);

      return {
        batchId: batch.id,
        productName: batch.productName,
        category: batch.category,
        ambientTempC,
        thermalMultiplier: Number(thermalMultiplier.toFixed(2)),
        nominalDte: batch.daysToExpiration,
        effectiveDte: Number(effectiveDte.toFixed(2)),
        sellThroughProbability: Number(sellThroughProb.toFixed(3)),
        recommendation: isCritical ? 'ROUTE_TO_DONATION' : 'APPLY_DYNAMIC_MARKDOWN',
        pricing: {
          originalPrice: batch.originalPrice,
          tier: tier.tier,
          tierLabel: tier.label,
          discountPercentage: `${(tier.discount * 100).toFixed(0)}%`,
          unconstrainedPrice: Number(unconstrainedPrice.toFixed(2)),
          floorPrice: Number(floorPrice.toFixed(2)),
          finalPrice: Number(finalPrice.toFixed(2)),
          floorProtected: finalPrice > unconstrainedPrice,
        },
      };
    }

    case 'route_donation_manifest': {
      const batch = INVENTORY.find((b) => b.id === args.batchId);
      if (!batch) {
        throw new Error(`Batch not found: ${args.batchId}`);
      }
      const foodBankId = args.foodBankId || 'FB-LA-REGIONAL';
      const foodBank = FOOD_BANKS[foodBankId];
      if (!foodBank) {
        throw new Error(`Unknown 501(c)(3) Food Bank ID: ${foodBankId}`);
      }

      const totalCostBasis = batch.costBasis * batch.quantity;
      const totalFmv = batch.originalPrice * batch.quantity;
      const markup = Math.max(0, totalFmv - totalCostBasis);
      const halfMarkup = 0.5 * markup;
      const additionalDeduction = Math.min(halfMarkup, totalCostBasis);
      const totalDeduction = totalCostBasis + additionalDeduction;
      const taxSavings21 = totalDeduction * 0.21;

      return {
        manifestId: `MANIFEST-${Date.now().toString(36).toUpperCase()}`,
        status: 'CERTIFIED_501C3_RECOVERY',
        batchId: batch.id,
        productName: batch.productName,
        category: batch.category,
        quantity: batch.quantity,
        donor: {
          entity: 'FreshFlow Supermarket Retail Operations',
          storeId: 'STORE-LA-101',
        },
        recipient: foodBank,
        statutoryCompliance: {
          code: '26 U.S. Code § 170(e)(3)',
          protectionAct: 'Bill Emerson Good Samaritan Food Donation Act (42 U.S.C. § 1791)',
          exclusiveUseCertified: true,
          commercialSaleProhibited: true,
        },
        taxValuation: {
          unitCostBasis: batch.costBasis,
          unitFmv: batch.originalPrice,
          totalCostBasis: Number(totalCostBasis.toFixed(2)),
          totalFairMarketValue: Number(totalFmv.toFixed(2)),
          unrealizedAppreciation: Number(markup.toFixed(2)),
          statutoryEnhancedDeduction: Number(totalDeduction.toFixed(2)),
          estimatedCorporateTaxBenefit: Number(taxSavings21.toFixed(2)),
          invariantsSatisfied: {
            deductionExceedsCostBasis: totalDeduction >= totalCostBasis,
            deductionWithinDoubleCostCap: totalDeduction <= 2 * totalCostBasis,
            deductionWithinFmvCap: totalDeduction <= totalFmv,
          },
        },
      };
    }

    case 'query_audit_trail': {
      const database = getDb();
      const rows = database
        .prepare('SELECT entry_id, entry_type, batch_id, store_id, occurred_at, payload FROM audit_entries WHERE batch_id = ? ORDER BY occurred_at ASC')
        .all(args.batchId);
      return {
        batchId: args.batchId,
        entryCount: rows.length,
        entries: rows.map((r) => ({
          entryId: r.entry_id,
          entryType: r.entry_type,
          storeId: r.store_id,
          occurredAt: r.occurred_at,
          payload: JSON.parse(r.payload),
        })),
      };
    }

    default:
      throw new Error(`Tool not found: ${name}`);
  }
}

// JSON-RPC 2.0 Dispatcher
function processMessage(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'freshflow-inventory-server',
          version: '1.0.0',
        },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null; // Notifications have no response
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS,
      },
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params;
    try {
      const result = handleToolCall(name, toolArgs || {});
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message,
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

// STDIO Transport Loop
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const message = JSON.parse(trimmed);
    const response = processMessage(message);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err) {
    const errResp = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${err.message}`,
      },
    };
    process.stdout.write(JSON.stringify(errResp) + '\n');
  }
});
