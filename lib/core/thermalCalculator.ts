/**
 * lib/core/thermalCalculator.ts — Pure functional thermal decay factor computation.
 *
 * Implements Arrhenius-based and Q10-based thermal decay factors.
 * Zero I/O — no fetch, no fs, no database, no console.log.
 * All domain errors return { ok: false, error: string } — never throw.
 */

import type { TemperatureReading, ThermalDecayFactors } from '../types';

// ---------------------------------------------------------------------------
// Result type for this module
// ---------------------------------------------------------------------------

export type ThermalResult =
  | { ok: true; value: ThermalDecayFactors }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Universal gas constant, J/(mol·K) */
const R = 8.314;

/** Kelvin offset */
const KELVIN_OFFSET = 273.15;

/** Valid temperature sensor range in Celsius */
const TEMP_MIN_C = -30;
const TEMP_MAX_C = 60;

/** Valid Q10 coefficient range (inclusive) */
const Q10_MIN = 1.0;
const Q10_MAX = 5.0;

/** Valid activation energy range in kJ/mol (inclusive) */
const EA_MIN_KJ = 10;
const EA_MAX_KJ = 200;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeMeanCelsius(history: TemperatureReading[]): number {
  const sum = history.reduce((acc, r) => acc + r.celsius, 0);
  return sum / history.length;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Computes the thermal decay factor for a perishable batch given its
 * temperature history and reference thermal parameters.
 *
 * Path selection:
 * - Q10 path: used when `q10Coefficient` is within [1.0, 5.0] (inclusive)
 * - Arrhenius path: used when `q10Coefficient` is absent (0) or outside [1.0, 5.0]
 *   Note: a non-zero q10Coefficient that falls outside [1.0, 5.0] is a validation error.
 *   Only q10Coefficient = 0 (sentinel for "not provided") triggers the Arrhenius fallback.
 *
 * @param history  Array of temperature readings (timestampIso + celsius)
 * @param factors  Reference temperature, optional Q10, and activation energy
 * @returns        ThermalResult — either valid ThermalDecayFactors or an error
 */
export function computeThermalDecayFactor(
  history: TemperatureReading[],
  factors: Pick<
    ThermalDecayFactors,
    'referenceTemperatureCelsius' | 'q10Coefficient' | 'activationEnergyKJ'
  >
): ThermalResult {
  const { q10Coefficient, activationEnergyKJ, referenceTemperatureCelsius } = factors;

  // --- Validation 1: non-empty history ---
  if (!history || history.length === 0) {
    return { ok: false, error: 'temperatureHistory must be non-empty' };
  }

  // --- Validation 2: all readings within sensor range ---
  for (let i = 0; i < history.length; i++) {
    const { celsius } = history[i];
    if (celsius < TEMP_MIN_C || celsius > TEMP_MAX_C) {
      return {
        ok: false,
        error: `celsius value ${celsius} at index ${i} is out of range [−30, 60]`,
      };
    }
  }

  // --- Validation 3: q10 present (non-zero) AND outside [1.0, 5.0] → error ---
  // q10Coefficient = 0 is the sentinel meaning "not provided" → use Arrhenius path
  const q10IsProvided = q10Coefficient !== 0;
  const q10InRange = q10Coefficient >= Q10_MIN && q10Coefficient <= Q10_MAX;

  if (q10IsProvided && !q10InRange) {
    return {
      ok: false,
      error: `q10Coefficient ${q10Coefficient} is outside valid range [1.0, 5.0]`,
    };
  }

  // --- Validation 4: activationEnergyKJ range — only on the Arrhenius path ---
  const useQ10 = q10IsProvided && q10InRange;

  if (!useQ10) {
    if (activationEnergyKJ < EA_MIN_KJ || activationEnergyKJ > EA_MAX_KJ) {
      return {
        ok: false,
        error: `activationEnergyKJ ${activationEnergyKJ} is outside valid range [10, 200]`,
      };
    }
  }

  // --- Compute mean temperature ---
  const T_mean = computeMeanCelsius(history);
  const T_ref = referenceTemperatureCelsius;

  // --- Compute decay factor ---
  let computedDecayFactor: number;

  if (useQ10) {
    // Q10 path: decayFactor = q10 ^ ((T_mean − T_ref) / 10)
    computedDecayFactor = Math.pow(q10Coefficient, (T_mean - T_ref) / 10);
  } else {
    // Arrhenius path: decayFactor = exp(−Ea/R × (1/T_mean_K − 1/T_ref_K))
    const Ea = activationEnergyKJ * 1000; // Convert kJ/mol to J/mol
    const T_mean_K = T_mean + KELVIN_OFFSET;
    const T_ref_K = T_ref + KELVIN_OFFSET;
    computedDecayFactor = Math.exp(-(Ea / R) * (1 / T_mean_K - 1 / T_ref_K));
  }

  return {
    ok: true,
    value: {
      referenceTemperatureCelsius,
      q10Coefficient,
      activationEnergyKJ,
      computedDecayFactor,
      // effectiveDteReductionDays is computed later by the shelf-life calculator
      effectiveDteReductionDays: 0,
    },
  };
}
