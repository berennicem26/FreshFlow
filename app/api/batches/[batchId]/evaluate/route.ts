/**
 * app/api/batches/[batchId]/evaluate/route.ts — Full pricing & donation evaluation pipeline.
 *
 * Sequence:
 * 1. Fetch ambient temperature (from WeatherSync or simulated input)
 * 2. Compute Arrhenius / Q10 thermal decay factor
 * 3. Compute biologically adjusted effective DTE and sell-through probability
 * 4. Build tiered pricing decision (with salvage floor enforcement)
 * 5. Route to food bank if eligible and build IRS Section 170(e)(3) manifest
 * 6. Persist all decisions and manifests to SQLite AuditLedger
 */

import { NextResponse } from 'next/server';
import { EvaluateRequestSchema } from '@/lib/schemas';
import {
  getAuditLedger,
  getBatchStore,
  getWeatherSync,
  REGISTERED_FOOD_BANKS,
} from '@/lib/services';
import { computeThermalDecayFactor } from '@/lib/core/thermalCalculator';
import { computeEffectiveDte } from '@/lib/core/shelfLifeCalculator';
import { buildPricingDecision } from '@/lib/core/pricingEngine';
import { buildDonationManifest, shouldDonate } from '@/lib/core/donationRouter';
import {
  resolveStorageZone,
  estimateProductTemperatureC,
  ZONE_REFERENCE_C,
} from '@/lib/core/storageProfile';
import type { TemperatureReading } from '@/lib/types';

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await context.params;
    const store = getBatchStore();
    const batch = store.get(batchId);

    if (!batch) {
      return NextResponse.json(
        { ok: false, error: `Batch ${batchId} not found` },
        { status: 404 }
      );
    }

    let requestBody: any = {};
    try {
      requestBody = await request.json();
    } catch {
      // Empty body is acceptable; defaults will be used
    }

    const parseResult = EvaluateRequestSchema.safeParse(requestBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid evaluation parameters', issues: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const options = parseResult.data;
    const nowIso = options.nowIso ?? new Date().toISOString();
    const storageZone = resolveStorageZone(batch);
    // Default: the batch's own cooler/shelf sensor readings (already product temperature).
    let temperatureReadings: TemperatureReading[] = [...batch.temperatureHistory];
    let weatherRationaleNote = '';

    // Converts an outdoor/store-ambient reading into the temperature the product actually sees.
    const toProductReading = (r: TemperatureReading): TemperatureReading => ({
      timestampIso: r.timestampIso,
      celsius: Number(estimateProductTemperatureC(storageZone, r.celsius).toFixed(2)),
    });

    // Step 1: Ingest outdoor temperature and translate it to product temperature
    if (options.simulatedTemperatureCelsius !== undefined) {
      // Manual simulation mode (heatwave slider = outdoor temperature)
      temperatureReadings = [
        toProductReading({ timestampIso: nowIso, celsius: options.simulatedTemperatureCelsius }),
      ];
      weatherRationaleNote = `Outdoor temperature simulated at ${options.simulatedTemperatureCelsius}°C → ${storageZone} product at ${temperatureReadings[0].celsius}°C.`;
    } else {
      // Live or cached WeatherSync
      try {
        const weatherSync = getWeatherSync();
        const weatherRecord = await weatherSync.fetchAndStore({
          storeId: batch.storeId,
          latitude: options.latitude ?? 34.0522, // Default to LA
          longitude: options.longitude ?? -118.2437,
        });
        if (weatherRecord.readings.length > 0) {
          temperatureReadings = weatherRecord.readings.map(toProductReading);
          weatherRationaleNote = `Weather data synchronized from Open-Meteo (fetched: ${weatherRecord.fetchedAtIso}); translated to ${storageZone} product temperature.`;
        }
      } catch {
        weatherRationaleNote = 'Weather service unavailable; using batch internal sensor history.';
      }
    }

    // Step 2: Compute thermal decay factor (category-specific Q10, zone-specific reference)
    const CATEGORY_Q10: Record<string, number> = {
      dairy: 2.5,
      produce: 2.2,
      meat: 2.8,
      bakery: 2.0,
      prepared: 2.4,
    };

    const q10Coefficient = CATEGORY_Q10[batch.category.toLowerCase()] ?? 2.5;

    const thermalFactorsConfig = {
      // Normal conditions for this display zone → decay factor 1.0
      referenceTemperatureCelsius: ZONE_REFERENCE_C[storageZone],
      q10Coefficient,
      activationEnergyKJ: 50,
    };

    const thermalResult = computeThermalDecayFactor(
      temperatureReadings,
      thermalFactorsConfig
    );

    if (!thermalResult.ok) {
      return NextResponse.json(
        { ok: false, error: thermalResult.error },
        { status: 400 }
      );
    }

    const decayFactor = thermalResult.value.computedDecayFactor;

    // Step 3: Compute biological shelf life
    const shelfLifeResult = computeEffectiveDte(batch, decayFactor, nowIso);
    if (!shelfLifeResult.ok) {
      return NextResponse.json(
        { ok: false, error: shelfLifeResult.error },
        { status: 400 }
      );
    }

    const { effectiveDte, sellThroughProbability } = shelfLifeResult;

    // Step 4: Build dynamic pricing decision
    const pricingResult = buildPricingDecision(
      batch,
      effectiveDte,
      sellThroughProbability,
      nowIso
    );

    if (!pricingResult.ok) {
      return NextResponse.json(
        { ok: false, error: pricingResult.error },
        { status: 400 }
      );
    }

    let decision = pricingResult.value;
    if (weatherRationaleNote) {
      decision = {
        ...decision,
        rationale: `${decision.rationale} [${weatherRationaleNote}]`,
      };
    }

    // Step 5: Check Donation Eligibility
    // Pricing tier and shouldDonate share lib/core/retailPolicy.ts, so they always agree.
    let donationManifest = null;
    const isDonationCandidate =
      decision.tier === 'DONATION' && shouldDonate(effectiveDte, sellThroughProbability);

    if (isDonationCandidate) {
      const storeCoords = {
        latitude: options.latitude ?? 34.0522,
        longitude: options.longitude ?? -118.2437,
      };

      const manifestResult = buildDonationManifest(
        batch,
        effectiveDte,
        sellThroughProbability,
        storeCoords,
        REGISTERED_FOOD_BANKS,
        undefined,
        nowIso
      );

      if (manifestResult.ok) {
        donationManifest = manifestResult.value;
      }
    }

    // Persist Pricing Decision and Manifest to AuditLedger
    const ledger = getAuditLedger();
    await ledger.insertEntry({
      entryType: 'PRICING_DECISION',
      batchId: batch.batchId,
      storeId: batch.storeId,
      payload: decision,
    });

    if (donationManifest) {
      await ledger.insertEntry({
        entryType: 'DONATION_MANIFEST',
        batchId: batch.batchId,
        storeId: batch.storeId,
        payload: donationManifest,
      });
    }

    const productTemperatureCelsius =
      temperatureReadings.reduce((s, r) => s + r.celsius, 0) / temperatureReadings.length;

    return NextResponse.json({
      ok: true,
      batchId: batch.batchId,
      storageZone,
      productTemperatureCelsius: Number(productTemperatureCelsius.toFixed(1)),
      thermalDecay: thermalResult.value,
      effectiveDte,
      sellThroughProbability,
      pricingDecision: decision,
      donationManifest,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Internal server error during evaluation' },
      { status: 500 }
    );
  }
}
