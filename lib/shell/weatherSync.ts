/**
 * lib/shell/weatherSync.ts — Imperative shell adapter for Open-Meteo weather synchronization.
 *
 * Responsibilities:
 * - Fetch 48-hour hourly ambient temperature forecast from Open-Meteo MCP / API
 * - Transform responses into canonical WeatherSyncRecord structures
 * - Persist weather sync records to the SQLite AuditLedger
 * - Enforce a 60-minute minimum sync interval guard per store
 * - Implement 2-retry policy (3 attempts total) with 30-second interval
 * - Provide 24-hour cache fallback on persistent upstream failure
 * - Emit configuration and failure events
 *
 * This is IMPERATIVE SHELL — network I/O, database writes, and side effects are permitted here.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type { AuditLedger } from '../db/auditLedger';
import type { TemperatureReading, WeatherSyncRecord } from '../types';

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export class WeatherSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherSyncError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WeatherSyncError);
    }
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface StoreLocation {
  readonly storeId: string;
  readonly latitude: number; // -90 to 90
  readonly longitude: number; // -180 to 180
}

export interface OpenMeteoHourlyResponse {
  readonly latitude: number;
  readonly longitude: number;
  readonly hourly: {
    readonly time: string[];
    readonly temperature_2m: number[];
  };
}

export interface McpClient {
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// WeatherSync Class
// ---------------------------------------------------------------------------

export class WeatherSync extends EventEmitter {
  private readonly ledger: AuditLedger;
  private readonly mcpClient?: McpClient;
  private readonly retryDelayMs: number;
  private readonly lastSyncTimes = new Map<string, number>();
  private readonly inMemoryCache = new Map<string, WeatherSyncRecord>();

  /** 60-minute interval in milliseconds */
  private static readonly SYNC_INTERVAL_MS = 60 * 60 * 1000;

  /** 24-hour cache validity threshold in milliseconds */
  private static readonly CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  constructor(
    ledger: AuditLedger,
    mcpClient?: McpClient,
    retryDelayMs: number = 30000
  ) {
    super();
    this.ledger = ledger;
    this.mcpClient = mcpClient;
    this.retryDelayMs = retryDelayMs;
  }

  /**
   * Validates latitude and longitude boundaries per Requirements 10.7.
   */
  private validateCoordinates(location: StoreLocation): void {
    if (location.latitude < -90 || location.latitude > 90) {
      this.emit('config_error', {
        storeId: location.storeId,
        field: 'latitude',
        value: location.latitude,
      });
      throw new WeatherSyncError(
        `Invalid latitude ${location.latitude} for store ${location.storeId}: must be in [-90, 90]`
      );
    }

    if (location.longitude < -180 || location.longitude > 180) {
      this.emit('config_error', {
        storeId: location.storeId,
        field: 'longitude',
        value: location.longitude,
      });
      throw new WeatherSyncError(
        `Invalid longitude ${location.longitude} for store ${location.storeId}: must be in [-180, 180]`
      );
    }
  }

  /**
   * Transforms raw Open-Meteo hourly response to canonical WeatherSyncRecord.
   */
  private transformToWeatherSyncRecord(
    response: OpenMeteoHourlyResponse,
    storeId: string
  ): WeatherSyncRecord {
    const readings: TemperatureReading[] = response.hourly.time.map((ts, i) => ({
      timestampIso: ts,
      celsius: response.hourly.temperature_2m[i],
    }));

    return {
      syncId: randomUUID(),
      storeId,
      fetchedAtIso: new Date().toISOString(),
      locationLatitude: response.latitude,
      locationLongitude: response.longitude,
      readings,
      forecastHorizonHours: readings.length,
    };
  }

  /**
   * Internal worker: executes the Open-Meteo tool call or HTTP fetch.
   */
  private async executeFetch(location: StoreLocation): Promise<OpenMeteoHourlyResponse> {
    if (this.mcpClient) {
      const res = (await this.mcpClient.callTool('get_forecast', {
        latitude: location.latitude,
        longitude: location.longitude,
        hourly: ['temperature_2m'],
        forecast_days: 2,
        timezone: 'UTC',
      })) as OpenMeteoHourlyResponse;
      return res;
    }

    // Direct HTTP fetch fallback to Open-Meteo open public API (no key required)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&hourly=temperature_2m&forecast_days=2&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP request failed with status ${res.status}`);
    }
    return (await res.json()) as OpenMeteoHourlyResponse;
  }

  /**
   * Fetches weather data with a 2-retry policy (3 attempts total) and 24-hour cache fallback.
   */
  private async fetchWithRetryAndFallback(
    location: StoreLocation
  ): Promise<WeatherSyncRecord> {
    const MAX_RETRIES = 2; // 1 initial + 2 retries = 3 attempts total

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const raw = await this.executeFetch(location);
        const record = this.transformToWeatherSyncRecord(raw, location.storeId);

        // Persist to audit ledger
        await this.ledger.insertEntry({
          entryType: 'WEATHER_SYNC',
          batchId: null,
          storeId: location.storeId,
          payload: record,
        });

        // Update in-memory caches
        this.lastSyncTimes.set(location.storeId, Date.now());
        this.inMemoryCache.set(location.storeId, record);

        return record;
      } catch (err) {
        if (attempt < MAX_RETRIES && this.retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        }
      }
    }

    // All retries exhausted -> Attempt 24-hour cache fallback (Requirement 10.4)
    const cached = this.inMemoryCache.get(location.storeId);
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAtIso).getTime();
      if (age <= WeatherSync.CACHE_MAX_AGE_MS) {
        return cached;
      }
    }

    // No valid cache exists -> Emit failure event & throw (Requirement 10.5)
    this.emit('sync_failure', {
      storeId: location.storeId,
      error: 'All retries exhausted and no valid weather cache within 24 hours exists',
    });

    throw new WeatherSyncError(
      `Weather sync failed for store ${location.storeId}: all retries exhausted and no valid cache available`
    );
  }

  /**
   * Fetch (or serve from cache) weather for a store.
   * Enforces 60-minute sync interval guard per store.
   */
  async fetchAndStore(location: StoreLocation): Promise<WeatherSyncRecord> {
    this.validateCoordinates(location);

    const lastSync = this.lastSyncTimes.get(location.storeId);
    const cached = this.inMemoryCache.get(location.storeId);

    // If synced within the last 60 minutes, return cached record immediately
    if (lastSync && cached && Date.now() - lastSync < WeatherSync.SYNC_INTERVAL_MS) {
      return cached;
    }

    return this.fetchWithRetryAndFallback(location);
  }

  /**
   * Force a sync regardless of the 60-minute interval guard.
   */
  async forceSync(location: StoreLocation): Promise<WeatherSyncRecord> {
    this.validateCoordinates(location);
    return this.fetchWithRetryAndFallback(location);
  }

  /**
   * Seed cache directly for test setups or system restarts.
   */
  seedCache(storeId: string, record: WeatherSyncRecord): void {
    this.inMemoryCache.set(storeId, record);
    this.lastSyncTimes.set(storeId, new Date(record.fetchedAtIso).getTime());
  }
}
