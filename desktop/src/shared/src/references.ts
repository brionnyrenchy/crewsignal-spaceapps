import {
  type MetricId,
  type Observation,
  type PersonalReference,
  type ReferenceValue,
} from './contracts';
import {
  convertGlucose,
  convertTemperature,
  roundToDecimals,
} from './conversions';
import {
  formatDurationHoursMinutes,
  getObservedMissionDay,
  parseUtcMs,
} from './timing';

export const FALLBACK_REFERENCE_DAYS_REQUIRED = 7 as const;

export function isObservationQualityEligible(observation: Observation): boolean {
  return observation.quality === 'valid';
}

export function computeMedian(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('Cannot compute median of empty array');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface FallbackReferenceOptions {
  profileId: string;
  metricId: Exclude<MetricId, 'mood'>;
  method: string;
  context: string;
  observations: readonly Observation[];
  createdAtUtc: string;
  existingVersion?: number;
  sleepDayRepresentatives?: Record<number, string>;
}

/**
 * Deterministic 7-day distinct observed-day fallback median heuristic.
 * - Uses only valid observations matching metricId, method, and context
 * - Unknown ('Not specified') method or context is ineligible
 * - Instant metrics: earliest observedAtUtc per distinct missionDay, tie-break by observationId asc
 * - Blood pressure: chooses 7 whole pairs first, then computes component medians on that pair set
 * - Sleep: Main sleep only; multiple periods on one endingMissionDay flag that day as ambiguous
 *   until a representative observationId is supplied via sleepDayRepresentatives
 * - Locks starting version once 7 distinct eligible days exist; otherwise Comparison unavailable
 */
export function deriveSevenDayFallbackReference(
  options: FallbackReferenceOptions,
): PersonalReference {
  const {
    profileId,
    metricId,
    method,
    context,
    observations,
    createdAtUtc,
    existingVersion = 1,
    sleepDayRepresentatives = {},
  } = options;

  const baseId = `ref-fallback-${metricId}-v${existingVersion}`;

  if (method === 'Not specified' || context === 'Not specified') {
    return {
      referenceId: baseId,
      profileId,
      metricId,
      version: existingVersion,
      provenance: 'seven_day_fallback_median',
      method,
      context,
      unit: getCanonicalUnitForMetric(metricId),
      value: null,
      sampleCount: 0,
      distinctObservedDays: 0,
      selectedObservationIds: [],
      ambiguousDays: [],
      status: 'unavailable',
      locked: false,
      unavailableReason:
        'Comparison unavailable: a compatible method and context are required for a fallback reference.',
      createdAtUtc,
      label: `7-day median heuristic (prototype) · Version ${existingVersion}`,
    };
  }

  // Deduplicate by observationId first
  const uniqueById = new Map<string, Observation>();
  for (const obs of observations) {
    if (!uniqueById.has(obs.observationId)) {
      uniqueById.set(obs.observationId, obs);
    }
  }

  const eligible = [...uniqueById.values()].filter((obs) => {
    if (obs.profileId !== profileId) return false;
    if (obs.metricId !== metricId) return false;
    if (!isObservationQualityEligible(obs)) return false;
    if (obs.method !== method || obs.context !== context) return false;
    if (metricId === 'sleep') {
      return obs.timing.kind === 'period' && obs.timing.sleepType === 'main_sleep';
    }
    return obs.timing.kind === 'instant';
  });

  // Group by distinct observed mission day (instant missionDay or sleep endingMissionDay)
  const byDay = new Map<number, Observation[]>();
  for (const obs of eligible) {
    const day = getObservedMissionDay(obs);
    const list = byDay.get(day) ?? [];
    list.push(obs);
    byDay.set(day, list);
  }

  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);
  const ambiguousDays: number[] = [];
  const chosenRepresentatives: Observation[] = [];

  for (const day of sortedDays) {
    const candidates = byDay.get(day)!;
    if (metricId === 'sleep') {
      if (candidates.length === 1) {
        chosenRepresentatives.push(candidates[0]!);
      } else {
        const chosenId = sleepDayRepresentatives[day];
        const match = chosenId
          ? candidates.find((c) => c.observationId === chosenId)
          : undefined;
        if (match) {
          chosenRepresentatives.push(match);
        } else {
          ambiguousDays.push(day);
        }
      }
    } else {
      // Earliest observedAtUtc per day; deterministic observationId tie-breaker
      const sorted = [...candidates].sort((a, b) => {
        const aMs =
          a.timing.kind === 'instant' ? parseUtcMs(a.timing.observedAtUtc) : 0;
        const bMs =
          b.timing.kind === 'instant' ? parseUtcMs(b.timing.observedAtUtc) : 0;
        if (aMs !== bMs) return aMs - bMs;
        return a.observationId < b.observationId
          ? -1
          : a.observationId > b.observationId
            ? 1
            : 0;
      });
      chosenRepresentatives.push(sorted[0]!);
    }
  }

  const distinctObservedDays = chosenRepresentatives.length;

  if (distinctObservedDays < FALLBACK_REFERENCE_DAYS_REQUIRED) {
    const ambiguityNote =
      ambiguousDays.length > 0
        ? ` Ambiguous multi-period main sleep days (${ambiguousDays.join(', ')}) require choosing a representative.`
        : '';
    return {
      referenceId: baseId,
      profileId,
      metricId,
      version: existingVersion,
      provenance: 'seven_day_fallback_median',
      method,
      context,
      unit: getCanonicalUnitForMetric(metricId),
      value: null,
      sampleCount: distinctObservedDays,
      distinctObservedDays,
      selectedObservationIds: chosenRepresentatives.map((o) => o.observationId),
      ambiguousDays,
      status: 'unavailable',
      locked: false,
      unavailableReason: `Comparison unavailable: ${distinctObservedDays} of ${FALLBACK_REFERENCE_DAYS_REQUIRED} distinct eligible observed days available.${ambiguityNote}`,
      createdAtUtc,
      label: `7-day median heuristic (prototype) · Version ${existingVersion}`,
    };
  }

  // Use the first 7 distinct eligible observed days and lock the starting reference
  const firstSeven = chosenRepresentatives.slice(0, FALLBACK_REFERENCE_DAYS_REQUIRED);
  const selectedIds = firstSeven.map((o) => o.observationId);
  let refValue: ReferenceValue;

  if (metricId === 'blood_pressure') {
    const sysVals = firstSeven.map((o) => {
      if (o.canonical.kind !== 'blood_pressure') {
        throw new Error('Expected blood_pressure canonical value');
      }
      return o.canonical.systolic;
    });
    const diaVals = firstSeven.map((o) => {
      if (o.canonical.kind !== 'blood_pressure') {
        throw new Error('Expected blood_pressure canonical value');
      }
      return o.canonical.diastolic;
    });
    refValue = {
      kind: 'blood_pressure',
      systolic: roundToDecimals(computeMedian(sysVals), 1),
      diastolic: roundToDecimals(computeMedian(diaVals), 1),
    };
  } else if (metricId === 'sleep') {
    const mins = firstSeven.map((o) => {
      if (o.canonical.kind !== 'sleep_duration') {
        throw new Error('Expected sleep_duration canonical value');
      }
      return o.canonical.durationMinutes;
    });
    refValue = {
      kind: 'sleep_duration',
      durationMinutes: Math.round(computeMedian(mins)),
    };
  } else {
    const scalars = firstSeven.map((o) => {
      if (o.canonical.kind !== 'scalar') {
        throw new Error('Expected scalar canonical value');
      }
      return o.canonical.value;
    });
    refValue = {
      kind: 'scalar',
      value: roundToDecimals(computeMedian(scalars), 3),
    };
  }

  return {
    referenceId: baseId,
    profileId,
    metricId,
    version: existingVersion,
    provenance: 'seven_day_fallback_median',
    method,
    context,
    unit: getCanonicalUnitForMetric(metricId),
    value: refValue,
    sampleCount: firstSeven.length,
    distinctObservedDays: firstSeven.length,
    selectedObservationIds: selectedIds,
    ambiguousDays,
    status: 'active',
    locked: true,
    unavailableReason: null,
    createdAtUtc,
    label: `7-day median heuristic (prototype) · Version ${existingVersion}`,
  };
}

function getCanonicalUnitForMetric(metricId: Exclude<MetricId, 'mood'>): string {
  switch (metricId) {
    case 'heart_rate':
      return 'bpm';
    case 'blood_pressure':
      return 'mmHg';
    case 'blood_glucose':
      return 'mg/dL';
    case 'body_temperature':
      return 'C';
    case 'sleep':
      return 'min';
  }
}

/**
 * Resolves the active PersonalReference for a metric, preferring entered preflight
 * or user-updated locked references before falling back to the 7-day median heuristic.
 * Never silently retrains an already-locked reference.
 */
export function resolveActiveReference(params: {
  profileId: string;
  metricId: MetricId;
  references: readonly PersonalReference[];
  observations: readonly Observation[];
  referenceMethod?: string;
  referenceContext?: string;
  nowUtc: string;
  sleepDayRepresentatives?: Record<number, string>;
}): PersonalReference | null {
  if (params.metricId === 'mood') {
    return null;
  }

  const activeExplicit = params.references.find(
    (r) =>
      r.profileId === params.profileId &&
      r.metricId === params.metricId &&
      r.status === 'active' &&
      r.value !== null,
  );
  if (activeExplicit) {
    return activeExplicit;
  }

  // Only attempt fallback if method/context are specified or inferred from an explicit request
  if (!params.referenceMethod || !params.referenceContext) {
    return null;
  }

  return deriveSevenDayFallbackReference({
    profileId: params.profileId,
    metricId: params.metricId,
    method: params.referenceMethod,
    context: params.referenceContext,
    observations: params.observations,
    createdAtUtc: params.nowUtc,
    sleepDayRepresentatives: params.sleepDayRepresentatives,
  });
}

/**
 * Creates a new locked PersonalReference version while marking previous active
 * versions as superseded, preserving full reference history.
 */
export function createNewReferenceVersion(params: {
  existingReferences: readonly PersonalReference[];
  profileId: string;
  metricId: Exclude<MetricId, 'mood'>;
  provenance: 'entered_preflight' | 'user_updated';
  method: string;
  context: string;
  unit: string;
  value: ReferenceValue;
  createdAtUtc: string;
  referenceIdPrefix?: string;
}): PersonalReference[] {
  const metricRefs = params.existingReferences.filter(
    (r) => r.profileId === params.profileId && r.metricId === params.metricId,
  );
  const maxVersion = metricRefs.reduce((max, r) => Math.max(max, r.version), 0);
  const nextVersion = maxVersion + 1;
  const prefix = params.referenceIdPrefix ?? `ref-${params.profileId}-${params.metricId}`;

  const updated = params.existingReferences.map((r) =>
    r.profileId === params.profileId &&
    r.metricId === params.metricId &&
    r.status === 'active'
      ? { ...r, status: 'superseded' as const }
      : r,
  );

  const labelPrefix =
    params.provenance === 'entered_preflight'
      ? 'Entered preflight'
      : 'Personal reference';

  const newRef: PersonalReference = {
    referenceId: `${prefix}-v${nextVersion}`,
    profileId: params.profileId,
    metricId: params.metricId,
    version: nextVersion,
    provenance: params.provenance,
    method: params.method,
    context: params.context,
    unit: params.unit,
    value: params.value,
    sampleCount: 1,
    distinctObservedDays: 1,
    selectedObservationIds: [],
    ambiguousDays: [],
    status: 'active',
    locked: true,
    unavailableReason: null,
    createdAtUtc: params.createdAtUtc,
    label: `${labelPrefix} · Version ${nextVersion}`,
  };

  return [...updated, newRef];
}

export interface ObservationComparisonResult {
  comparisonAvailable: boolean;
  unavailableReason: string | null;
  referenceId: string | null;
  referenceVersion: number | null;
  differenceText: string | null;
  deltaNumeric: number | null;
  deltaUnit: string | null;
}

/**
 * Compares a single Observation against an active PersonalReference.
 * Enforces strict compatibility: unknown ('Not specified') methods, incompatible
 * methods/contexts, Nap/Other periods vs Main sleep, questionable quality, or
 * insufficient coverage yield Comparison unavailable.
 */
export function compareObservationToReference(
  observation: Observation,
  reference: PersonalReference | null,
): ObservationComparisonResult {
  if (observation.metricId === 'mood') {
    return {
      comparisonAvailable: false,
      unavailableReason:
        'Mood uses discrete ordinal self-report history rather than a numeric reference.',
      referenceId: null,
      referenceVersion: null,
      differenceText: null,
      deltaNumeric: null,
      deltaUnit: null,
    };
  }

  if (!isObservationQualityEligible(observation)) {
    return {
      comparisonAvailable: false,
      unavailableReason:
        'Comparison unavailable because this observation is flagged for quality recheck.',
      referenceId: reference?.referenceId ?? null,
      referenceVersion: reference?.version ?? null,
      differenceText: null,
      deltaNumeric: null,
      deltaUnit: null,
    };
  }

  if (observation.method === 'Not specified') {
    return {
      comparisonAvailable: false,
      unavailableReason: 'A compatible method is not known.',
      referenceId: reference?.referenceId ?? null,
      referenceVersion: reference?.version ?? null,
      differenceText: null,
      deltaNumeric: null,
      deltaUnit: null,
    };
  }

  if (!reference || reference.status !== 'active' || reference.value === null) {
    return {
      comparisonAvailable: false,
      unavailableReason:
        reference?.unavailableReason ??
        'Comparison unavailable: no compatible personal reference is available.',
      referenceId: reference?.referenceId ?? null,
      referenceVersion: reference?.version ?? null,
      differenceText: null,
      deltaNumeric: null,
      deltaUnit: null,
    };
  }

  if (observation.metricId === 'sleep') {
    if (
      observation.timing.kind !== 'period' ||
      observation.timing.sleepType !== 'main_sleep'
    ) {
      return {
        comparisonAvailable: false,
        unavailableReason:
          'Nap and other sleep periods do not inherit the main-sleep personal reference.',
        referenceId: reference.referenceId,
        referenceVersion: reference.version,
        differenceText: null,
        deltaNumeric: null,
        deltaUnit: null,
      };
    }
  }

  if (
    observation.method !== reference.method ||
    observation.context !== reference.context
  ) {
    return {
      comparisonAvailable: false,
      unavailableReason:
        'Comparison unavailable: measurement method or context differs from the active personal reference.',
      referenceId: reference.referenceId,
      referenceVersion: reference.version,
      differenceText: null,
      deltaNumeric: null,
      deltaUnit: null,
    };
  }

  if (
    observation.canonical.kind === 'sleep_duration' &&
    reference.value.kind === 'sleep_duration'
  ) {
    const delta =
      observation.canonical.durationMinutes - reference.value.durationMinutes;
    if (delta === 0) {
      return {
        comparisonAvailable: true,
        unavailableReason: null,
        referenceId: reference.referenceId,
        referenceVersion: reference.version,
        differenceText: 'Matches reference',
        deltaNumeric: 0,
        deltaUnit: 'min',
      };
    }
    const absText = formatDurationHoursMinutes(Math.abs(delta));
    const direction = delta < 0 ? 'below reference' : 'above reference';
    return {
      comparisonAvailable: true,
      unavailableReason: null,
      referenceId: reference.referenceId,
      referenceVersion: reference.version,
      differenceText: `${absText} ${direction}`,
      deltaNumeric: delta,
      deltaUnit: 'min',
    };
  }

  if (
    observation.canonical.kind === 'blood_pressure' &&
    reference.value.kind === 'blood_pressure'
  ) {
    const dSys = roundToDecimals(
      observation.canonical.systolic - reference.value.systolic,
      1,
    );
    const dDia = roundToDecimals(
      observation.canonical.diastolic - reference.value.diastolic,
      1,
    );
    const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    return {
      comparisonAvailable: true,
      unavailableReason: null,
      referenceId: reference.referenceId,
      referenceVersion: reference.version,
      differenceText: `${fmt(dSys)}/${fmt(dDia)} mmHg from reference`,
      deltaNumeric: dSys,
      deltaUnit: 'mmHg',
    };
  }

  if (
    observation.canonical.kind === 'scalar' &&
    reference.value.kind === 'scalar'
  ) {
    let refCanonical = reference.value.value;
    if (
      observation.metricId === 'body_temperature' &&
      (reference.unit === 'F' || reference.unit === 'C')
    ) {
      refCanonical = convertTemperature(refCanonical, reference.unit, 'C').exact;
    } else if (
      observation.metricId === 'blood_glucose' &&
      (reference.unit === 'mmol/L' || reference.unit === 'mg/dL')
    ) {
      refCanonical = convertGlucose(refCanonical, reference.unit, 'mg/dL').exact;
    }

    const delta = roundToDecimals(observation.canonical.value - refCanonical, 2);
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    const absVal = Math.abs(delta);
    const unitDisplay =
      observation.canonical.unit === 'C' ? '°C' : observation.canonical.unit;
    return {
      comparisonAvailable: true,
      unavailableReason: null,
      referenceId: reference.referenceId,
      referenceVersion: reference.version,
      differenceText:
        delta === 0
          ? 'Matches reference'
          : `${sign}${absVal} ${unitDisplay} from reference`,
      deltaNumeric: delta,
      deltaUnit: observation.canonical.unit,
    };
  }

  return {
    comparisonAvailable: false,
    unavailableReason: 'Incompatible value shape for comparison.',
    referenceId: reference.referenceId,
    referenceVersion: reference.version,
    differenceText: null,
    deltaNumeric: null,
    deltaUnit: null,
  };
}

/**
 * Chooses the seven-day fallback reference that should be persisted (locked) for
 * a metric, or null when nothing should be written.
 *
 * - Returns null when the profile already has any stored reference for the metric
 *   (active or superseded): a lock is never re-derived from later observations,
 *   earlier imports, or a restart; only an explicit update creates a new version.
 * - Otherwise considers each specified method/context combination and picks the
 *   one that first reached seven distinct observed days (earliest seventh
 *   representative day; ties go to the larger sample, then alphabetical order).
 *
 * Callers persist the result in a transaction that re-checks that no reference
 * exists yet, then resolve comparisons from the stored record only.
 */
export function selectFallbackReferenceToLock(params: {
  profileId: string;
  metricId: MetricId;
  references: readonly PersonalReference[];
  observations: readonly Observation[];
  nowUtc: string;
  sleepDayRepresentatives?: Record<number, string>;
}): PersonalReference | null {
  const { profileId, metricId } = params;
  if (metricId === 'mood') return null;
  const hasStored = params.references.some(
    (r) => r.profileId === profileId && r.metricId === metricId,
  );
  if (hasStored) return null;

  const byId = new Map<string, Observation>();
  const combos = new Map<string, { method: string; context: string }>();
  for (const obs of params.observations) {
    if (obs.profileId !== profileId || obs.metricId !== metricId) continue;
    byId.set(obs.observationId, obs);
    if (obs.method === 'Not specified' || obs.context === 'Not specified') continue;
    combos.set(`${obs.method}\u0000${obs.context}`, { method: obs.method, context: obs.context });
  }

  let best: { ref: PersonalReference; seventhDay: number; key: string } | null = null;
  for (const [key, combo] of combos) {
    const derived = deriveSevenDayFallbackReference({
      profileId,
      metricId,
      method: combo.method,
      context: combo.context,
      observations: params.observations,
      createdAtUtc: params.nowUtc,
      existingVersion: 1,
      sleepDayRepresentatives: params.sleepDayRepresentatives,
    });
    if (derived.status !== 'active' || derived.value === null) continue;
    const seventhDay = Math.max(
      ...derived.selectedObservationIds.map((id) => {
        const obs = byId.get(id);
        return obs ? getObservedMissionDay(obs) : Number.POSITIVE_INFINITY;
      }),
    );
    if (
      !best ||
      seventhDay < best.seventhDay ||
      (seventhDay === best.seventhDay && derived.sampleCount > best.ref.sampleCount) ||
      (seventhDay === best.seventhDay &&
        derived.sampleCount === best.ref.sampleCount &&
        key < best.key)
    ) {
      best = { ref: derived, seventhDay, key };
    }
  }
  if (!best) return null;
  return {
    ...best.ref,
    // Profile-scoped ID: stores keyed by reference ID alone must not collide
    // between a Demo and a Personal profile.
    referenceId: `ref-${profileId}-${metricId}-fallback-v1`,
    locked: true,
  };
}
