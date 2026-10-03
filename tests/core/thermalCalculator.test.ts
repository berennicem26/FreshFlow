/**
 * tests/core/thermalCalculator.test.ts
 *
 * Unit tests for edge cases and validations in lib/core/thermalCalculator.ts.
 * Validates: Requirements 1.1, 1.4, 1.5, 1.6
 */

import { describe, it, expect } from 'vitest';
import { computeThermalDecayFactor } from '../../lib/core/thermalCalculator';

describe('thermalCalculator edge cases & validations', () => {
  const validFactors = {
    referenceTemperatureCelsius: 4,
    q10Coefficient: 2.5,
    activationEnergyKJ: 50,
  };

  it('rejects empty temperature history', () => {
    const res = computeThermalDecayFactor([], validFactors);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('temperatureHistory must be non-empty');
    }
  });

  it('rejects temperatures below -30°C', () => {
    const history = [
      { timestampIso: '2026-10-03T10:00:00Z', celsius: 4 },
      { timestampIso: '2026-10-03T11:00:00Z', celsius: -31 },
    ];
    const res = computeThermalDecayFactor(history, validFactors);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('is out of range [−30, 60]');
    }
  });

  it('rejects temperatures above 60°C', () => {
    const history = [{ timestampIso: '2026-10-03T10:00:00Z', celsius: 65 }];
    const res = computeThermalDecayFactor(history, validFactors);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('is out of range [−30, 60]');
    }
  });

  it('rejects invalid non-zero Q10 coefficient outside [1.0, 5.0]', () => {
    const history = [{ timestampIso: '2026-10-03T10:00:00Z', celsius: 20 }];
    const res = computeThermalDecayFactor(history, {
      ...validFactors,
      q10Coefficient: 0.5,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('is outside valid range [1.0, 5.0]');
    }
  });

  it('computes accurate Q10 decay factor when Q10 is 2.0 and temp is 14°C (10°C above ref 4°C)', () => {
    const history = [{ timestampIso: '2026-10-03T10:00:00Z', celsius: 14 }];
    const res = computeThermalDecayFactor(history, {
      referenceTemperatureCelsius: 4,
      q10Coefficient: 2.0,
      activationEnergyKJ: 50,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 2.0 ^ ((14 - 4) / 10) = 2.0 ^ 1 = 2.0
      expect(res.value.computedDecayFactor).toBeCloseTo(2.0, 4);
    }
  });

  it('uses Arrhenius path when q10Coefficient is 0', () => {
    const history = [{ timestampIso: '2026-10-03T10:00:00Z', celsius: 24 }];
    const res = computeThermalDecayFactor(history, {
      referenceTemperatureCelsius: 4,
      q10Coefficient: 0,
      activationEnergyKJ: 60,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.computedDecayFactor).toBeGreaterThan(1.0);
    }
  });
});
