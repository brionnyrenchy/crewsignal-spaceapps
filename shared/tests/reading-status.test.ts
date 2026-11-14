import { describe, expect, it } from 'vitest';
import {
  DARK_THEME_TOKENS,
  LIGHT_THEME_TOKENS,
  READING_STATUSES,
  READING_STATUS_ORDER,
  SIM_01_OBSERVATIONS,
  SIM_01_REFERENCES,
  SIM_01_SNAPSHOT_UTC,
  compareObservationToReference,
  evaluateMetricSchedule,
  getReadingStatus,
  type Observation,
  type PersonalReference,
} from '../src/index';

const heartRate = SIM_01_OBSERVATIONS.find((o) => o.metricId === 'heart_rate')!;
const hrReference = SIM_01_REFERENCES.find((r) => r.metricId === 'heart_rate')!;
const mood = SIM_01_OBSERVATIONS.find((o) => o.metricId === 'mood')!;

function schedule(observation: Observation | null, now: string = SIM_01_SNAPSHOT_UTC) {
  return evaluateMetricSchedule({
    metricId: observation?.metricId ?? 'heart_rate',
    latestObservation: observation,
    schedule: { enabled: true, intervalHours: 1, configuredAtUtc: SIM_01_SNAPSHOT_UTC },
    referenceNowUtc: now,
  });
}

describe('reading status', () => {
  it('distinguishes unlogged, stale, unavailable, matching and differing readings', () => {
    const comparison = compareObservationToReference(heartRate, hrReference);
    expect(getReadingStatus(null, null, schedule(null))).toBe('not_logged');
    expect(getReadingStatus(heartRate, comparison, schedule(heartRate, '2026-11-13T09:00:00Z'))).toBe('stale');
    expect(getReadingStatus(heartRate, compareObservationToReference(heartRate, null), schedule(heartRate))).toBe('no_reference');
    expect(getReadingStatus(heartRate, comparison, schedule(heartRate))).toBe('differs');

    const matching: PersonalReference = { ...hrReference, value: { kind: 'scalar', value: 72 } };
    expect(getReadingStatus(heartRate, compareObservationToReference(heartRate, matching), schedule(heartRate))).toBe('near');
    const incompatible = { ...heartRate, method: 'Not specified' };
    expect(getReadingStatus(incompatible, compareObservationToReference(incompatible, matching), schedule(incompatible))).toBe('no_reference');
  });

  it('keeps logged mood at No reference and includes diastolic differences', () => {
    const bp = SIM_01_OBSERVATIONS.find((o) => o.metricId === 'blood_pressure')!;
    if (bp.canonical.kind !== 'blood_pressure') throw new Error('Expected a blood pressure fixture');
    const reference: PersonalReference = {
      ...hrReference,
      metricId: bp.metricId,
      method: bp.method,
      context: bp.context,
      unit: 'mmHg',
      value: { kind: 'blood_pressure', systolic: bp.canonical.systolic, diastolic: bp.canonical.diastolic - 1 },
    };
    expect(getReadingStatus(bp, compareObservationToReference(bp, reference), schedule(bp))).toBe('differs');
    expect(getReadingStatus(mood, null, schedule(mood, '2026-11-14T00:00:00Z'))).toBe('no_reference');
  });

  it('uses distinct non-color cues and WCAG AA text contrast in both themes', () => {
    function luminance(hex: string) {
      const channels = [1, 3, 5].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    }

    expect(new Set(READING_STATUS_ORDER.map((status) => READING_STATUSES[status].icon)).size).toBe(5);
    expect(new Set(READING_STATUS_ORDER.map((status) => READING_STATUSES[status].label)).size).toBe(5);
    for (const palette of [DARK_THEME_TOKENS, LIGHT_THEME_TOKENS]) {
      for (const { fg, bg } of Object.values(palette.readingStatus)) {
        const [darker, lighter] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
        expect((lighter! + 0.05) / (darker! + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
