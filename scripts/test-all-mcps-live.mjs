#!/usr/bin/env node
/**
 * scripts/test-all-mcps-live.mjs
 *
 * Real End-to-End Live Verification Test for ALL configured MCP Servers:
 * 1. FreshFlow SQLite Inventory Server (`scripts/mcp-inventory-server.mjs`)
 * 2. FreshFlow Fetch MCP Server (`scripts/mcp-fetch-server.mjs`)
 *
 * Spawns both servers over STDIO, conducts full JSON-RPC 2.0 handshakes,
 * queries live Open-Meteo endpoints over the internet, and verifies database persistence.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { join } from 'path';

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    totalPassed++;
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    totalFailed++;
  }
}

function createMcpClient(scriptName) {
  const serverPath = join(process.cwd(), 'scripts', scriptName);
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const rl = createInterface({
    input: server.stdout,
    terminal: false,
  });

  const pending = new Map();

  rl.on('line', (line) => {
    try {
      const resp = JSON.parse(line.trim());
      if (resp.id && pending.has(resp.id)) {
        const resolve = pending.get(resp.id);
        pending.delete(resp.id);
        resolve(resp);
      }
    } catch (e) {
      console.error(`[${scriptName}] Parse error:`, line, e);
    }
  });

  let nextId = 1;
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  return { server, send, kill: () => server.kill() };
}

async function runLiveTests() {
  console.log('='.repeat(78));
  console.log(' FRESHFLOW END-TO-END MCP LIVE SUITE: REAL SERVER & LIVE NETWORK TEST');
  console.log('='.repeat(78));

  // =========================================================================
  // SERVER 1: SQLite Inventory Server
  // =========================================================================
  console.log('\n[SERVER 1] Testing SQLite Inventory MCP Server (scripts/mcp-inventory-server.mjs)');
  const invClient = createMcpClient('mcp-inventory-server.mjs');

  try {
    const init = await invClient.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'live-test-agent', version: '1.0.0' },
    });
    assert(init.result.serverInfo.name === 'freshflow-inventory-server', 'Handshake: Server name matches');
    assert(init.result.protocolVersion === '2024-11-05', 'Handshake: Protocol version 2024-11-05 confirmed');

    const toolsResp = await invClient.send('tools/list');
    const toolNames = toolsResp.result.tools.map((t) => t.name);
    assert(toolNames.length === 6, `Discovery: Exposes exactly 6 tools (found: ${toolNames.length})`);
    assert(toolNames.includes('get_perishable_inventory'), 'Discovery: Tool get_perishable_inventory found');
    assert(toolNames.includes('fetch_open_meteo_weather'), 'Discovery: Tool fetch_open_meteo_weather found');
    assert(toolNames.includes('evaluate_batch_markdown'), 'Discovery: Tool evaluate_batch_markdown found');
    assert(toolNames.includes('route_donation_manifest'), 'Discovery: Tool route_donation_manifest found');
    assert(toolNames.includes('calculate_arrhenius_decay'), 'Discovery: Tool calculate_arrhenius_decay found');
    assert(toolNames.includes('query_audit_trail'), 'Discovery: Tool query_audit_trail found');

    // Tool 1: get_perishable_inventory
    const inv = await invClient.send('tools/call', {
      name: 'get_perishable_inventory',
      arguments: { category: 'Meat' },
    });
    const invData = JSON.parse(inv.result.content[0].text);
    assert(invData.inventory.length >= 1, 'Inventory: Found Meat category batch');
    assert(invData.inventory[0].productName === 'USDA Choice Ribeye Steak', 'Inventory: Correct product returned');

    // Tool 2: fetch_open_meteo_weather (Real Open-Meteo live API query)
    console.log('  -> Executing REAL network call to Open-Meteo API...');
    const weather = await invClient.send('tools/call', {
      name: 'fetch_open_meteo_weather',
      arguments: { latitude: 34.0522, longitude: -118.2437, storeId: 'STORE-LA-101' },
    });
    const weatherData = JSON.parse(weather.result.content[0].text);
    assert(typeof weatherData.ambientTemperatureC === 'number', `Weather: Live temperature parsed (${weatherData.ambientTemperatureC}°C)`);
    assert(weatherData.source.startsWith('open-meteo'), `Weather: Data confirmed from source (${weatherData.source})`);
    assert(weatherData.thermalDecayMultipliers.Seafood >= 1.0, `Weather: Kinetic acceleration computed (Seafood: ${weatherData.thermalDecayMultipliers.Seafood}x)`);

    // Tool 3: evaluate_batch_markdown (Invariant P4)
    const markdown = await invClient.send('tools/call', {
      name: 'evaluate_batch_markdown',
      arguments: { batchId: 'BATCH-DAIRY-001', ambientTempC: weatherData.ambientTemperatureC },
    });
    const markdownData = JSON.parse(markdown.result.content[0].text);
    assert(markdownData.pricing.finalPrice >= markdownData.pricing.floorPrice, 'Pricing: Enforced 30% floor price protection');
    assert(markdownData.effectiveDte <= markdownData.nominalDte, 'Shelf-Life: Effective DTE <= Nominal DTE');

    // Tool 4: route_donation_manifest (Invariant P6)
    const donation = await invClient.send('tools/call', {
      name: 'route_donation_manifest',
      arguments: { batchId: 'BATCH-SEAFOOD-004', foodBankId: 'FB-LA-REGIONAL' },
    });
    const donData = JSON.parse(donation.result.content[0].text);
    assert(donData.status === 'CERTIFIED_501C3_RECOVERY', 'Donation: 501(c)(3) certified');
    assert(donData.taxValuation.statutoryEnhancedDeduction >= donData.taxValuation.totalCostBasis, 'IRS § 170(e)(3): Deduction >= Cost Basis');
    assert(donData.taxValuation.statutoryEnhancedDeduction <= donData.taxValuation.totalFairMarketValue, 'IRS § 170(e)(3): Deduction <= FMV');

    // Tool 5: query_audit_trail (SQLite persistence)
    const audit = await invClient.send('tools/call', {
      name: 'query_audit_trail',
      arguments: { batchId: 'BATCH-DAIRY-001' },
    });
    const auditData = JSON.parse(audit.result.content[0].text);
    assert(auditData.batchId === 'BATCH-DAIRY-001', 'Audit: SQLite ledger returned query result');
  } finally {
    invClient.kill();
  }

  // =========================================================================
  // SERVER 2: Fetch MCP Server (Calling Open-Meteo REST directly)
  // =========================================================================
  console.log('\n[SERVER 2] Testing Fetch MCP Server (scripts/mcp-fetch-server.mjs)');
  const fetchClient = createMcpClient('mcp-fetch-server.mjs');

  try {
    const init = await fetchClient.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'live-test-agent', version: '1.0.0' },
    });
    assert(init.result.serverInfo.name === 'freshflow-fetch-server', 'Handshake: Fetch server identified');

    const toolsResp = await fetchClient.send('tools/list');
    assert(toolsResp.result.tools[0].name === 'fetch', 'Discovery: Tool "fetch" available');

    console.log('  -> Calling Open-Meteo REST endpoint via Fetch MCP server...');
    const liveFetchResp = await fetchClient.send('tools/call', {
      name: 'fetch',
      arguments: {
        url: 'https://api.open-meteo.com/v1/forecast?latitude=34.05&longitude=-118.24&current=temperature_2m,relative_humidity_2m',
      },
    });

    const parsedContent = JSON.parse(liveFetchResp.result.content[0].text);
    assert(parsedContent.status === 200, 'HTTP Status: 200 OK');
    assert(parsedContent.contentType.includes('application/json'), 'Content-Type: application/json verified');

    const openMeteoData = JSON.parse(parsedContent.content);
    assert(openMeteoData.latitude !== undefined, 'Payload: Received latitude from Open-Meteo');
    assert(openMeteoData.current !== undefined, 'Payload: Received current conditions');
    assert(typeof openMeteoData.current.temperature_2m === 'number', `Payload: Real temperature is ${openMeteoData.current.temperature_2m}°C`);
    assert(typeof openMeteoData.current.relative_humidity_2m === 'number', `Payload: Real humidity is ${openMeteoData.current.relative_humidity_2m}%`);

  } finally {
    fetchClient.kill();
  }

  console.log('\n' + '='.repeat(78));
  console.log(` ALL MCP SERVERS VERIFICATION: ${totalPassed} Passed, ${totalFailed} Failed`);
  console.log('='.repeat(78));

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runLiveTests();
