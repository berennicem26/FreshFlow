#!/usr/bin/env node
/**
 * scripts/mcp-fetch-server.mjs
 *
 * Standalone Node.js implementation of the Model Context Protocol (MCP) Fetch Server.
 * Exposes the standard `fetch` tool for retrieving web content, HTML, and REST APIs (like Open-Meteo).
 * Zero external dependencies — runs natively with Node.js built-in fetch and readline.
 */

import { createInterface } from 'readline';

const TOOLS = [
  {
    name: 'fetch',
    description: 'Fetch web content or API data from a URL. Useful for retrieving live weather forecasts, documentation, or public endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch (HTTP or HTTPS)',
        },
        max_length: {
          type: 'number',
          description: 'Maximum number of characters to return (default: 5000)',
        },
        start_index: {
          type: 'number',
          description: 'Character offset to start returning content from (default: 0)',
        },
        raw: {
          type: 'boolean',
          description: 'Return raw response body without markdown conversion (default: false)',
        },
      },
      required: ['url'],
    },
  },
];

async function handleFetch(args) {
  const { url, max_length = 5000, start_index = 0, raw = false } = args;

  if (!url) {
    throw new Error('URL is required');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FreshFlow-MCP-Fetch/1.0',
        'Accept': '*/*',
      },
    });
    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    let output = text;
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(text);
        output = JSON.stringify(parsed, null, 2);
      } catch {
        // use raw text
      }
    } else if (!raw && contentType.includes('text/html')) {
      // Basic HTML tag stripping for readability
      output = text
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const sliced = output.slice(start_index, start_index + max_length);

    return {
      url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      length: sliced.length,
      totalLength: output.length,
      hasMore: start_index + max_length < output.length,
      content: sliced,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Fetch failed for ${url}: ${err.message}`);
  }
}

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
          name: 'freshflow-fetch-server',
          version: '1.0.0',
        },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null;
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
    if (name === 'fetch') {
      try {
        const result = await handleFetch(toolArgs || {});
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
        message: `Unknown tool: ${name}`,
      },
    };
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
