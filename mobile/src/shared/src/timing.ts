import {
  type InstantTiming,
  type MetricId,
  type MetricSchedule,
  type Observation,
  type PeriodTiming,
  type SleepType,
} from './contracts';

export const MS_PER_MINUTE = 60_000 as const;
export const MS_PER_HOUR = 3_600_000 as const;
export const MS_PER_DAY = 86_400_000 as const;

export function parseUtcMs(isoUtc: string): number {
  if (!isoUtc.endsWith('Z') && !isoUtc.endsWith('+00:00')) {
    throw new RangeError(`Timestamp must be UTC ISO-8601: ${isoUtc}`);
  }
  const ms = Date.parse(isoUtc);
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Invalid UTC timestamp: ${isoUtc}`);
  }
  return ms;
}

/**
 * Computes mission day (1-based) from configured UTC mission epoch.
 * Example: epoch 2026-10-03T00:00:00Z, timestamp 2026-11-13T07:18:00Z -> Day 42.
 */
export function computeMissionDay(
  timestampUtc: string,
  missionEpochUtc: string,
): number {
  const tsMs = parseUtcMs(timestampUtc);
  const epochMs = parseUtcMs(missionEpochUtc);
  const diffDays = Math.floor((tsMs - epochMs) / MS_PER_DAY);
  return diffDays + 1;
}

export function formatUtcTimeHHMM(timestampUtc: string): string {
  const d = new Date(parseUtcMs(timestampUtc));
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function parseHHMM(hhmm: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return { hours, minutes };
}

/**
 * Converts a 1-based mission day and HH:MM UTC time back into a canonical UTC ISO string.
 */
export function missionDayAndTimeToUtc(
  missionEpochUtc: string,
  missionDay: number,
  hhmm: string,
): string {
  if (!Number.isInteger(missionDay) || missionDay < 1) {
    throw new RangeError(`Mission day must be integer >= 1, got ${missionDay}`);
  }
  const parsed = parseHHMM(hhmm);
  if (!parsed) {
    throw new RangeError(`Invalid HH:MM time: ${hhmm}`);
  }
  const epochMs = parseUtcMs(missionEpochUtc);
  const ms =
    epochMs +
    (missionDay - 1) * MS_PER_DAY +
    parsed.hours * MS_PER_HOUR +
    parsed.minutes * MS_PER_MINUTE;
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function buildInstantTiming(params: {
  observedAtUtc: string;
  missionEpochUtc: string;
  originalTimezone?: string;
  precision?: 'minute' | 'second' | 'day';
}): InstantTiming {
  const missionDay = computeMissionDay(
    params.observedAtUtc,
    params.missionEpochUtc,
  );
  if (missionDay < 1) {
    throw new RangeError(
      `Observed timestamp ${params.observedAtUtc} precedes mission epoch ${params.missionEpochUtc}`,
    );
  }
  return {
    kind: 'instant',
    observedAtUtc: params.observedAtUtc,
    missionEpochUtc: params.missionEpochUtc,
    missionDay,
    missionTimeLabel: formatUtcTimeHHMM(params.observedAtUtc),
    originalTimezone: params.originalTimezone ?? 'UTC',
    precision: params.precision ?? 'minute',
  };
}

export function buildPeriodTiming(params: {
  sleepType: SleepType;
  endingMissionDay: number;
  durationMinutes: number;
  reportedAtUtc: string;
  missionEpochUtc: string;
  originalTimezone?: string;
  precision?: 'estimated_minutes' | 'exact_window' | 'minute';
  windowStartUtc?: string | null;
  windowEndUtc?: string | null;
}): PeriodTiming {
  if (!Number.isInteger(params.endingMissionDay) || params.endingMissionDay < 1) {
    throw new RangeError(`Invalid endingMissionDay: ${params.endingMissionDay}`);
  }
  if (!Number.isInteger(params.durationMinutes) || params.durationMinutes < 0) {
    throw new RangeError(`Invalid durationMinutes: ${params.durationMinutes}`);
  }
  const reportedMissionDay = computeMissionDay(
    params.reportedAtUtc,
    params.missionEpochUtc,
  );
  const windowStartUtc = params.windowStartUtc ?? null;
  const windowEndUtc = params.windowEndUtc ?? null;

  return {
    kind: 'period',
    sleepType: params.sleepType,
    endingMissionDay: params.endingMissionDay,
    durationMinutes: params.durationMinutes,
    reportedAtUtc: params.reportedAtUtc,
    reportedMissionDay,
    reportedTimeLabel: formatUtcTimeHHMM(params.reportedAtUtc),
    missionEpochUtc: params.missionEpochUtc,
    originalTimezone: params.originalTimezone ?? 'UTC',
    precision:
      params.precision ??
      (windowStartUtc && windowEndUtc ? 'exact_window' : 'estimated_minutes'),
    windowStartUtc,
    windowEndUtc,
    windowStartMissionDay: windowStartUtc
      ? computeMissionDay(windowStartUtc, params.missionEpochUtc)
      : null,
    windowStartTimeLabel: windowStartUtc
      ? formatUtcTimeHHMM(windowStartUtc)
      : null,
    windowEndMissionDay: windowEndUtc
      ? computeMissionDay(windowEndUtc, params.missionEpochUtc)
      : null,
    windowEndTimeLabel: windowEndUtc ? formatUtcTimeHHMM(windowEndUtc) : null,
  };
}

export function computeAgeMinutes(fromUtc: string, toUtc: string): number {
  const fromMs = parseUtcMs(fromUtc);
  const toMs = parseUtcMs(toUtc);
  return Math.round((toMs - fromMs) / MS_PER_MINUTE);
}

export function formatDurationHoursMinutes(
  totalMinutes: number,
  options?: { padMinutes?: boolean },
): string {
  const abs = Math.abs(Math.trunc(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const mStr = options?.padMinutes ? m.toString().padStart(2, '0') : `${m}`;
  return `${h}h ${mStr}m`;
}

export function formatSignedMinutesDelta(deltaMinutes: number): string {
  if (deltaMinutes === 0) return '0m';
  const sign = deltaMinutes < 0 ? '−' : '+';
  const abs = Math.abs(Math.trunc(deltaMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m.toString().padStart(2, '0')}m`;
}

export interface SleepWindowValidationResult {
  valid: boolean;
  error: string | null;
  windowMinutes: number | null;
  startUtc: string | null;
  endUtc: string | null;
}

/**
 * Validates an optional exact sleep window without automatically overwriting
 * the user's estimated asleep duration (because a window may include awake time).
 */
export function validateSleepWindow(params: {
  missionEpochUtc: string;
  startMissionDay: number;
  startTimeHHMM: string;
  endMissionDay: number;
  endTimeHHMM: string;
}): SleepWindowValidationResult {
  if (
    !Number.isInteger(params.startMissionDay) ||
    params.startMissionDay < 1 ||
    !Number.isInteger(params.endMissionDay) ||
    params.endMissionDay < 1
  ) {
    return {
      valid: false,
      error: 'Enter valid mission days (>= 1) for the sleep window.',
      windowMinutes: null,
      startUtc: null,
      endUtc: null,
    };
  }
  const startParsed = parseHHMM(params.startTimeHHMM);
  const endParsed = parseHHMM(params.endTimeHHMM);
  if (!startParsed || !endParsed) {
    return {
      valid: false,
      error: 'Enter start and end times in 24-hour HH:MM format.',
      windowMinutes: null,
      startUtc: null,
      endUtc: null,
    };
  }

  const startUtc = missionDayAndTimeToUtc(
    params.missionEpochUtc,
    params.startMissionDay,
    params.startTimeHHMM,
  );
  const endUtc = missionDayAndTimeToUtc(
    params.missionEpochUtc,
    params.endMissionDay,
    params.endTimeHHMM,
  );
  const startMs = parseUtcMs(startUtc);
  const endMs = parseUtcMs(endUtc);

  if (endMs <= startMs) {
    return {
      valid: false,
      error: 'End must follow start; confirm the ending day.',
      windowMinutes: null,
      startUtc: null,
      endUtc: null,
    };
  }

  return {
    valid: true,
    error: null,
    windowMinutes: Math.round((endMs - startMs) / MS_PER_MINUTE),
    startUtc,
    endUtc,
  };
}

/**
 * Returns the observed mission day for any Observation (instant missionDay or period endingMissionDay).
 * Never uses recordedAtUtc or import time.
 */
export function getObservedMissionDay(observation: Observation): number {
  return observation.timing.kind === 'instant'
    ? observation.timing.missionDay
    : observation.timing.endingMissionDay;
}

/**
 * Returns the chronological sort timestamp for ordering observations.
 * Instant uses observedAtUtc; Period uses endingMissionDay end-anchor or reportedAtUtc.
 */
export function getObservationSortTimestampMs(observation: Observation): number {
  if (observation.timing.kind === 'instant') {
    return parseUtcMs(observation.timing.observedAtUtc);
  }
  const epochMs = parseUtcMs(observation.timing.missionEpochUtc);
  const dayStartMs = epochMs + (observation.timing.endingMissionDay - 1) * MS_PER_DAY;
  const reportedMs = parseUtcMs(observation.timing.reportedAtUtc);
  // Keep period sorting consistent by ending day; tie-break with reportedAtUtc within day
  return dayStartMs + (reportedMs % MS_PER_DAY);
}

export interface ScheduleFreshnessResult {
  metricId: MetricId;
  status: 'not_scheduled' | 'due_no_entries' | 'within_interval' | 'past_interval';
  ageMinutes: number | null;
  ageLabel: string | null;
  intervalHours: number | null;
  intervalLabel: string | null;
}

export function evaluateMetricSchedule(params: {
  metricId: MetricId;
  latestObservation: Observation | null;
  schedule: MetricSchedule | null;
  referenceNowUtc: string;
}): ScheduleFreshnessResult {
  const { metricId, latestObservation, schedule, referenceNowUtc } = params;
  let ageMinutes: number | null = null;
  let ageLabel: string | null = null;

  if (latestObservation) {
    const refTimestamp =
      latestObservation.timing.kind === 'instant'
        ? latestObservation.timing.observedAtUtc
        : latestObservation.timing.reportedAtUtc;
    ageMinutes = Math.max(0, computeAgeMinutes(refTimestamp, referenceNowUtc));
    ageLabel = formatDurationHoursMinutes(ageMinutes);
  }

  if (!schedule || !schedule.enabled) {
    return {
      metricId,
      status: 'not_scheduled',
      ageMinutes,
      ageLabel,
      intervalHours: null,
      intervalLabel: null,
    };
  }

  const intervalMinutes = Math.round(schedule.intervalHours * 60);
  const intervalLabel = `${schedule.intervalHours}h`;

  if (!latestObservation || ageMinutes === null) {
    return {
      metricId,
      status: 'due_no_entries',
      ageMinutes: null,
      ageLabel: null,
      intervalHours: schedule.intervalHours,
      intervalLabel,
    };
  }

  return {
    metricId,
    status: ageMinutes > intervalMinutes ? 'past_interval' : 'within_interval',
    ageMinutes,
    ageLabel,
    intervalHours: schedule.intervalHours,
    intervalLabel,
  };
}
