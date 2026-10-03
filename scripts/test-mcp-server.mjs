#!/usr/bin/env node
/**
 * scripts/test-mcp-server.mjs
 *
 * Automated verification test suite for FreshFlow MCP STDIO Server.
 * Sends JSON-RPC 2.0 messages over standard I/O and asserts compliance.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { join } from 'path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('='.repeat(70));
  console.log(' FreshFlow MCP Server Protocol Verification');
  console.log('='.repeat(70));

  const serverPath = join(process.cwd(), 'scripts', 'mcp-inventory-server.mjs');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const rl = createInterface({
    input: server.stdout,
    terminal: false,
  });

  const pendingRequests = new Map();

  rl.on('line', (line) => {
    try {
      const resp = JSON.parse(line.trim());
      if (resp.id && pendingRequests.has(resp.id)) {
        const resolve = pendingRequests.get(resp.id);
        pendingRequests.delete(resp.id);
        resolve(resp);
      }
    } catch (e) {
      console.error('Error parsing response line:', line, e);
    }
  });

  let messageId = 1;
  function sendRequest(method, params = {}) {
    const id = messageId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n';

    return new Promise((resolve) => {
      pendingRequests.set(id, resolve);
      server.stdin.write(payload);
    });
  }

  try {
    // Test 1: Initialize
    console.log('\n[1] Testing MCP Handshake (initialize)');
    const initResp = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'kiro-test-client', version: '1.0.0' },
    });
    assert(initResp.result !== undefined, 'Response has result object');
    assert(initResp.result.serverInfo.name === 'freshflow-inventory-server', 'Server name is freshflow-inventory-server');
    assert(initResp.result.protocolVersion === '2024-11-05', 'Protocol version is 2024-11-05');

    // Test 2: Tools List
    console.log('\n[2] Testing Tool Discovery (tools/list)');
    const toolsResp = await sendRequest('tools/list');
    const tools = toolsResp.result.tools;
    assert(Array.isArray(tools), 'Tools is an array');
    assert(tools.length >= 5, `Registered 5+ tools (found: ${tools.length})`);
    const toolNames = tools.map((t) => t.name);
    assert(toolNames.includes('get_perishable_inventory'), 'Tool get_perishable_inventory exists');
    assert(toolNames.includes('evaluate_batch_markdown'), 'Tool evaluate_batch_markdown exists');
    assert(toolNames.includes('route_donation_manifest'), 'Tool route_donation_manifest exists');
    assert(toolNames.includes('calculate_arrhenius_decay'), 'Tool calculate_arrhenius_decay exists');
    assert(toolNames.includes('query_audit_trail'), 'Tool query_audit_trail exists');

    // Test 3: get_perishable_inventory
    console.log('\n[3] Testing Tool Execution: get_perishable_inventory');
    const invResp = await sendRequest('tools/call', {
      name: 'get_perishable_inventory',
      arguments: { category: 'Dairy' },
    });
    const invData = JSON.parse(invResp.result.content[0].text);
    assert(invData.totalBatches >= 1, 'Returned dairy batches');
    assert(invData.inventory[0].category === 'Dairy', 'Filtered by Dairy category');

    // Test 4: calculate_arrhenius_decay
    console.log('\n[4] Testing Tool Execution: calculate_arrhenius_decay');
    const decayResp = await sendRequest('tools/call', {
      name: 'calculate_arrhenius_decay',
      arguments: {
        category: 'Produce',
        ambientTempC: 24.0,
        nominalDays: 2.0,
      },
    });
    const decayData = JSON.parse(decayResp.result.content[0].text);
    assert(decayData.thermalMultiplier > 1.0, `Thermal multiplier accelerated (${decayData.thermalMultiplier}x)`);
    assert(decayData.effectiveDays < 2.0, `Effective days reduced (${decayData.effectiveDays}d vs 2.0d)`);

    // Test 5: evaluate_batch_markdown
    console.log('\n[5] Testing Tool Execution: evaluate_batch_markdown (Price Floor Invariant P4)');
    const evalResp = await sendRequest('tools/call', {
      name: 'evaluate_batch_markdown',
      arguments: {
        batchId: 'BATCH-DAIRY-001',
        ambientTempC: 22.0,
      },
    });
    const evalData = JSON.parse(evalResp.result.content[0].text);
    assert(evalData.pricing !== undefined, 'Pricing structure returned');
    assert(evalData.pricing.finalPrice >= evalData.pricing.floorPrice, 'Final price satisfies 30% floor price invariant');
    assert(evalData.pricing.finalPrice > 0, 'Final price is positive');

    // Test 6: route_donation_manifest
    console.log('\n[6] Testing Tool Execution: route_donation_manifest (IRS § 170(e)(3) P6 Invariant)');
    const donationResp = await sendRequest('tools/call', {
      name: 'route_donation_manifest',
      arguments: {
        batchId: 'BATCH-MEAT-003',
        foodBankId: 'FB-LA-REGIONAL',
      },
    });
    const donationData = JSON.parse(donationResp.result.content[0].text);
    assert(donationData.status === 'CERTIFIED_501C3_RECOVERY', 'Donation status certified');
    assert(donationData.taxValuation.statutoryEnhancedDeduction >= donationData.taxValuation.totalCostBasis, 'Deduction >= Cost Basis');
    assert(donationData.taxValuation.statutoryEnhancedDeduction <= 2 * donationData.taxValuation.totalCostBasis, 'Deduction <= 2x Cost Basis');
    assert(donationData.taxValuation.statutoryEnhancedDeduction <= donationData.taxValuation.totalFairMarketValue, 'Deduction <= FMV');

    // Test 7: query_audit_trail
    console.log('\n[7] Testing Tool Execution: query_audit_trail');
    const auditResp = await sendRequest('tools/call', {
      name: 'query_audit_trail',
      arguments: {
        batchId: 'BATCH-DAIRY-001',
      },
    });
    const auditData = JSON.parse(auditResp.result.content[0].text);
    assert(auditData.batchId === 'BATCH-DAIRY-001', 'Query succeeded for batch');
    assert(Array.isArray(auditData.entries), 'Entries returned as array');

  } finally {
    server.kill();
  }

  console.log('\n' + '='.repeat(70));
  console.log(` RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('='.repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite();
