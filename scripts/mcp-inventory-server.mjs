#!/usr/bin/env node
/**
 * scripts/mcp-inventory-server.mjs
 *
 * FreshFlow Model Context Protocol (MCP) STDIO Server.
 * Exposes tools for perishable inventory management, Open-Meteo climate telemetry,
 * Arrhenius thermal decay, dynamic markdown pricing with floor enforcement,
 * and IRS § 170(e)(3) donation routing.
 *
 * Implements the MCP STDIO transport (JSON-RPC 2.0 over standard I/O).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

// Category Q10 coefficients (temperature sensitivity per +10°C)
const Q10_MAP = {
  Dairy: 2.5,
  Produce: 2.2,
  Meat: 2.8,
  Seafood: 3.0,
  Bakery: 2.0,
  Prepared: 2.4,
};

// ---------------------------------------------------------------------------
// Mirrors lib/core/storageProfile.ts and lib/core/retailPolicy.ts (keep in sync).
// Outdoor weather is NOT product temperature: coolers hold ~4°C, shelves follow
// the store's HVAC-dampened indoor temperature.
// ---------------------------------------------------------------------------
const DEFAULT_ZONE = {
  Dairy: 'refrigerated',
  Meat: 'refrigerated',
  Seafood: 'refrigerated',
  Prepared: 'refrigerated',
  Produce: 'ambient',
  Bakery: 'ambient',
};
const ZONE_REFERENCE_C = { refrigerated: 4.0, ambient: 20.0 };

function productTemperatureC(zone, outdoorC) {
  if (zone === 'refrigerated') return 4.0 + 0.15 * Math.max(0, outdoorC - 20.0);
  return Math.min(30.0, Math.max(16.0, 20.0 + 0.4 * (outdoorC - 20.0)));
}

function decayMultiplier(category, zone, outdoorC) {
  const q10 = Q10_MAP[category] || 2.2;
  const productC = productTemperatureC(zone, outdoorC);
  return { q10, productC, multiplier: Math.pow(q10, (productC - ZONE_REFERENCE_C[zone]) / 10.0) };
}

// Markdown tiers (same rates as lib/core/pricingEngine.ts)
const MARKDOWN_TIERS = {
  NONE: { tier: 0, discount: 0.0, label: 'Full Price' },
  TIER_1: { tier: 1, discount: 0.15, label: '15% Markdown' },
  TIER_2: { tier: 2, discount: 0.35, label: '35% Markdown' },
  TIER_3: { tier: 3, discount: 0.5, label: '50% Final Markdown' },
};

// Same schedule as lib/core/retailPolicy.ts
function evaluateTier(dte, stp) {
  if (dte < 1.0) return 'PULL';
  if (dte <= 2.0) return 'DONATION';
  if (dte <= 3.0 && stp < 0.5) return 'DONATION';
  if (dte <= 3.0) return 'TIER_3';
  if (dte <= 4.0) return 'TIER_2';
  if (dte <= 5.0 && stp < 0.9) return 'TIER_1';
  return 'NONE';
}

// Seeded batches
const INVENTORY = [
  {
    id: 'BATCH-DAIRY-001',
    productName: 'Organic Whole Milk 1 Gal',
    category: 'Dairy',
    costBasis: 2.10,
    originalPrice: 4.99,
    quantity: 45,
    daysToExpiration: 4.6,
    salesVelocity: 12.0,
  },
  {
    id: 'BATCH-PRODUCE-002',
    productName: 'Baby Spinach 16oz Clamshell',
    category: 'Produce',
    storageZone: 'refrigerated',
    costBasis: 1.40,
    originalPrice: 3.49,
    quantity: 28,
    daysToExpiration: 3.4,
    salesVelocity: 8.0,
  },
  {
    id: 'BATCH-MEAT-003',
    productName: 'USDA Choice Ribeye Steak',
    category: 'Meat',
    costBasis: 8.50,
    originalPrice: 16.99,
    quantity: 14,
    daysToExpiration: 3.2,
    salesVelocity: 3.0,
  },
  {
    id: 'BATCH-SEAFOOD-004',
    productName: 'Wild Atlantic Salmon Fillet',
    category: 'Seafood',
    costBasis: 7.20,
    originalPrice: 14.50,
    quantity: 18,
    daysToExpiration: 2.6,
    salesVelocity: 2.0,
  },
  {
    id: 'BATCH-BAKERY-005',
    productName: 'Artisan Sourdough Loaf',
    category: 'Bakery',
    costBasis: 1.10,
    originalPrice: 4.25,
    quantity: 22,
    daysToExpiration: 2.6,
    salesVelocity: 6.0,
  },
  {
    id: 'BATCH-PREPARED-006',
    productName: 'Rotisserie Chicken',
    category: 'Prepared',
    costBasis: 3.00,
    originalPrice: 7.99,
    quantity: 8,
    daysToExpiration: 1.8,
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
    name: 'fetch_open_meteo_weather',
    description: 'Fetch real-time ambient temperature and humidity from the Open-Meteo API for a store location, compute Arrhenius decay multipliers across all departments, and log a WEATHER_SYNC audit record.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Store latitude (-90 to 90), e.g. 34.0522 for Los Angeles',
        },
        longitude: {
          type: 'number',
          description: 'Store longitude (-180 to 180), e.g. -118.2437 for Los Angeles',
        },
        storeId: {
          type: 'string',
          description: 'Store identifier (e.g. STORE-LA-101)',
        },
      },
    },
  },
  {
    name: 'evaluate_batch_markdown',
    description: 'Evaluate thermal decay kinetics, effective shelf life, sell-through probability, and calculate the markdown tier (or donation / pull decision) with cost-basis price floor protection. Outdoor temperature is translated into cooler or shelf product temperature.',
    inputSchema: {
      type: 'object',
      properties: {
        batchId: {
          type: 'string',
          description: 'Unique identifier of the perishable batch (e.g. BATCH-DAIRY-001)',
        },
        ambientTempC: {
          type: 'number',
          description: 'Outdoor temperature in Celsius (default: 22.0°C)',
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
async function handleToolCall(name, args) {
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

    case 'fetch_open_meteo_weather': {
      const latitude = args.latitude !== undefined ? args.latitude : 34.0522;
      const longitude = args.longitude !== undefined ? args.longitude : -118.2437;
      const storeId = args.storeId || 'STORE-LA-101';

      let temperatureC = 26.5;
      let humidity = 52;
      let source = 'open-meteo-live';

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const data = await resp.json();
          if (data.current) {
            temperatureC = data.current.temperature_2m;
            humidity = data.current.relative_humidity_2m;
          }
        }
      } catch {
        source = 'telemetry-fallback-cache';
      }

      // Translate outdoor temperature into product temperature per department, then decay speed
      const decayMultipliers = {};
      for (const cat of Object.keys(Q10_MAP)) {
        const zone = DEFAULT_ZONE[cat] || 'refrigerated';
        decayMultipliers[cat] = Number(decayMultiplier(cat, zone, temperatureC).multiplier.toFixed(2));
      }

      // Log WEATHER_SYNC into SQLite Audit Ledger
      try {
        const database = getDb();
        const entryId = `WEATHER-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        const nowIso = new Date().toISOString();
        database.prepare(`
          INSERT INTO audit_entries (entry_id, entry_type, batch_id, store_id, occurred_at, payload)
          VALUES (?, 'WEATHER_SYNC', NULL, ?, ?, ?)
        `).run(
          entryId,
          storeId,
          nowIso,
          JSON.stringify({
            latitude,
            longitude,
            temperatureC,
            humidity,
            source,
            decayMultipliers,
          })
        );
      } catch {
        // Non-fatal if DB insert fails
      }

      return {
        storeId,
        coordinates: { latitude, longitude },
        ambientTemperatureC: temperatureC,
        relativeHumidityPct: humidity,
        source,
        thermalDecayMultipliers: decayMultipliers,
        heatwaveAlert: temperatureC >= 28.0,
        timestamp: new Date().toISOString(),
      };
    }

    case 'calculate_arrhenius_decay': {
      const zone = args.storageZone || DEFAULT_ZONE[args.category] || 'refrigerated';
      const { q10, productC, multiplier } = decayMultiplier(args.category, zone, args.ambientTempC);
      const effectiveDays = args.nominalDays / multiplier;
      return {
        category: args.category,
        storageZone: zone,
        q10Sensitivity: q10,
        referenceTempC: ZONE_REFERENCE_C[zone],
        outdoorTempC: args.ambientTempC,
        productTempC: Number(productC.toFixed(2)),
        thermalMultiplier: Number(multiplier.toFixed(3)),
        nominalDays: args.nominalDays,
        effectiveDays: Number(effectiveDays.toFixed(2)),
        decayFactorPercentage: `${((multiplier - 1) * 100).toFixed(1)}% faster degradation`,
      };
    }

    case 'evaluate_batch_markdown': {
      const batch = INVENTORY.find((b) => b.id === args.batchId);
      if (!batch) {
        throw new Error(`Batch not found: ${args.batchId}`);
      }
      const ambientTempC = args.ambientTempC !== undefined ? args.ambientTempC : 22.0;
      const zone = batch.storageZone || DEFAULT_ZONE[batch.category] || 'refrigerated';
      const { productC, multiplier } = decayMultiplier(batch.category, zone, ambientTempC);
      const effectiveDte = batch.daysToExpiration / multiplier;
      const sellThroughProb = Math.min(1.0, (batch.salesVelocity * effectiveDte) / batch.quantity);

      const tierKey = evaluateTier(effectiveDte, sellThroughProb);
      const recommendation =
        tierKey === 'DONATION' ? 'ROUTE_TO_DONATION' : tierKey === 'PULL' ? 'PULL_FROM_SALE' : 'APPLY_DYNAMIC_MARKDOWN';

      const base = {
        batchId: batch.id,
        productName: batch.productName,
        category: batch.category,
        storageZone: zone,
        outdoorTempC: ambientTempC,
        productTempC: Number(productC.toFixed(2)),
        thermalMultiplier: Number(multiplier.toFixed(2)),
        nominalDte: batch.daysToExpiration,
        effectiveDte: Number(effectiveDte.toFixed(2)),
        sellThroughProbability: Number(sellThroughProb.toFixed(3)),
        recommendation,
      };

      if (tierKey === 'DONATION' || tierKey === 'PULL') {
        return { ...base, pricing: null };
      }

      const tier = MARKDOWN_TIERS[tierKey];
      const unconstrainedPrice = batch.originalPrice * (1 - tier.discount);
      // Price floor = unit cost basis (never sell below cost), same as the app
      const floorPrice = batch.costBasis;
      const finalPrice = Math.max(floorPrice, unconstrainedPrice);

      return {
        ...base,
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
async function processMessage(message) {
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
      const result = await handleToolCall(name, toolArgs || {});
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

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const message = JSON.parse(trimmed);
    const response = await processMessage(message);
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
