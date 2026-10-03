/**
 * tests/shell/weatherSync.test.ts
 *
 * Integration tests for lib/shell/weatherSync.ts.
 * Validates: Requirements 10.1, 10.2, 10.4, 10.5, 10.6, 10.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { AuditLedger } from '../../lib/db/auditLedger';
import {
  WeatherSync,
  WeatherSyncError,
  type McpClient,
  type OpenMeteoHourlyResponse,
  type StoreLocation,
} from '../../lib/shell/weatherSync';

describe('WeatherSync integration tests', () => {
  const testDbPath = join(__dirname, 'test-weather.db');
  let ledger: AuditLedger;

  const validLocation: StoreLocation = {
    storeId: 'STORE-LA-01',
    latitude: 34.0522,
    longitude: -118.2437,
  };

  const mockOpenMeteoData: OpenMeteoHourlyResponse = {
    latitude: 34.05,
    longitude: -118.24,
    hourly: {
      time: [
        '2026-10-03T12:00:00Z',
        '2026-10-03T13:00:00Z',
        '2026-10-03T14:00:00Z',
      ],
      temperature_2m: [22.5, 23.1, 24.0],
    },
  };

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    ledger = new AuditLedger({ dbPath: testDbPath });
  });

  afterEach(() => {
    ledger.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('transforms valid MCP response and persists WeatherSyncRecord to AuditLedger', async () => {
    const mockMcpClient: McpClient = {
      callTool: vi.fn().mockResolvedValue(mockOpenMeteoData),
    };

    const weatherSync = new WeatherSync(ledger, mockMcpClient, 0);
    const record = await weatherSync.fetchAndStore(validLocation);

    expect(record.storeId).toBe('STORE-LA-01');
    expect(record.readings.length).toBe(3);
    expect(record.readings[0].celsius).toBe(22.5);
    expect(record.forecastHorizonHours).toBe(3);

    // Verify it was called with get_forecast
    expect(mockMcpClient.callTool).toHaveBeenCalledWith('get_forecast', {
      latitude: 34.0522,
      longitude: -118.2437,
      hourly: ['temperature_2m'],
      forecast_days: 2,
      timezone: 'UTC',
    });
  });

  it('serves from cache on second call within 60 minutes without re-querying MCP', async () => {
    const mockMcpClient: McpClient = {
      callTool: vi.fn().mockResolvedValue(mockOpenMeteoData),
    };

    const weatherSync = new WeatherSync(ledger, mockMcpClient, 0);

    const first = await weatherSync.fetchAndStore(validLocation);
    const second = await weatherSync.fetchAndStore(validLocation);

    expect(second.syncId).toBe(first.syncId);
    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
  });

  it('bypasses interval guard and calls MCP when using forceSync', async () => {
    const mockMcpClient: McpClient = {
      callTool: vi.fn().mockResolvedValue(mockOpenMeteoData),
    };

    const weatherSync = new WeatherSync(ledger, mockMcpClient, 0);

    await weatherSync.fetchAndStore(validLocation);
    await weatherSync.forceSync(validLocation);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
  });

  it('falls back to valid cache (< 24 hours old) when MCP calls fail after retries', async () => {
    let callCount = 0;
    const mockMcpClient: McpClient = {
      callTool: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return mockOpenMeteoData; // Initial success to populate cache
        }
        throw new Error('Network timeout'); // Subsequent failure
      }),
    };

    const weatherSync = new WeatherSync(ledger, mockMcpClient, 5);

    // Seed initial sync
    const initialRecord = await weatherSync.fetchAndStore(validLocation);
    expect(initialRecord.syncId).toBeDefined();

    // Now force a sync that fails upstream
    const fallbackRecord = await weatherSync.forceSync(validLocation);
    expect(fallbackRecord.syncId).toBe(initialRecord.syncId);
    // 1 initial call + 1 initial try on forceSync + 2 retries = 4 total attempts
    expect(callCount).toBe(4);
  });

  it('throws WeatherSyncError when MCP fails and no valid cache exists', async () => {
    const mockMcpClient: McpClient = {
      callTool: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };

    const weatherSync = new WeatherSync(ledger, mockMcpClient, 5);

    let eventEmitted = false;
    weatherSync.on('sync_failure', (evt) => {
      if (evt.storeId === 'STORE-LA-01') {
        eventEmitted = true;
      }
    });

    await expect(weatherSync.fetchAndStore(validLocation)).rejects.toThrow(
      WeatherSyncError
    );
    expect(eventEmitted).toBe(true);
  });

  it('emits config_error and throws when latitude is out of bounds', async () => {
    const weatherSync = new WeatherSync(ledger, undefined, 0);

    let errorEvent: any = null;
    weatherSync.on('config_error', (evt) => {
      errorEvent = evt;
    });

    const invalidLatLocation = { ...validLocation, latitude: 95.0 };

    await expect(weatherSync.fetchAndStore(invalidLatLocation)).rejects.toThrow(
      WeatherSyncError
    );
    expect(errorEvent).toEqual({
      storeId: 'STORE-LA-01',
      field: 'latitude',
      value: 95.0,
    });
  });

  it('emits config_error and throws when longitude is out of bounds', async () => {
    const weatherSync = new WeatherSync(ledger, undefined, 0);

    let errorEvent: any = null;
    weatherSync.on('config_error', (evt) => {
      errorEvent = evt;
    });

    const invalidLonLocation = { ...validLocation, longitude: -195.0 };

    await expect(weatherSync.fetchAndStore(invalidLonLocation)).rejects.toThrow(
      WeatherSyncError
    );
    expect(errorEvent).toEqual({
      storeId: 'STORE-LA-01',
      field: 'longitude',
      value: -195.0,
    });
  });
});
