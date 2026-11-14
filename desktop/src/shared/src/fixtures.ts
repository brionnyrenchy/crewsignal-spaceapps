import {
  CONVERSION_RULE_VERSION,
  CREWSIGNAL_SCHEMA_VERSION,
  MOOD_QUESTION_TEXT,
  MOOD_SCALE_ID,
  MOOD_SCALE_VERSION,
  type AppPreferences,
  type BackupBundle,
  type CheckInDraft,
  type DraftRecoveryBundle,
  type Insight,
  type Observation,
  type PersonalReference,
  type ProfileConfig,
  type ReportBundle,
} from './contracts';
import { buildSleepInsight } from './guidance';
import {
  buildBackupBundle,
  buildDraftRecoveryBundle,
  buildReportBundle,
  CSV_TEMPLATE_COLUMNS,
} from './interchange';
import { buildInstantTiming, buildPeriodTiming } from './timing';

export const SIM_01_EPOCH_UTC = '2026-10-03T00:00:00Z' as const;
export const SIM_01_SNAPSHOT_UTC = '2026-11-13T07:18:00Z' as const;
export const SIM_01_PROFILE_ID = 'sim-01-crew-01' as const;

export const SIM_01_PROFILE: ProfileConfig = {
  profileId: SIM_01_PROFILE_ID,
  label: 'Crew member 01',
  alias: 'SIM-01 Demo',
  mode: 'demo',
  scenarioId: 'SIM-01',
  missionName: 'Transit habitat',
  missionEpochUtc: SIM_01_EPOCH_UTC,
  displayTimezone: 'UTC',
  snapshotUtc: SIM_01_SNAPSHOT_UTC,
  createdAtUtc: '2026-10-03T00:00:00Z',
  clockVersion: 1,
  schedules: {
    heart_rate: null,
    blood_pressure: null,
    blood_glucose: null,
    body_temperature: null,
    sleep: null,
    mood: null,
  },
};

export const SIM_01_PREFERENCES: AppPreferences = {
  appearance: 'system',
  activeProfileId: SIM_01_PROFILE_ID,
  displayUnits: {
    blood_glucose: 'mg/dL',
    body_temperature: 'C',
  },
  helpMode: 'unconfigured',
};

const SLEEP_DAYS_DATA: ReadonlyArray<{
  day: number;
  datePrefix: string;
  hours: number;
  minutes: number;
}> = [
  { day: 36, datePrefix: '2026-11-07', hours: 7.2, minutes: 432 },
  { day: 37, datePrefix: '2026-11-08', hours: 7.5, minutes: 450 },
  { day: 38, datePrefix: '2026-11-09', hours: 7.1, minutes: 426 },
  { day: 39, datePrefix: '2026-11-10', hours: 6.8, minutes: 408 },
  { day: 40, datePrefix: '2026-11-11', hours: 6.5, minutes: 390 },
  { day: 41, datePrefix: '2026-11-12', hours: 6.2, minutes: 372 },
  { day: 42, datePrefix: '2026-11-13', hours: 5.8, minutes: 348 },
];

export const SIM_01_SLEEP_SERIES_HOURS = SLEEP_DAYS_DATA.map((d) => ({
  missionDay: d.day,
  hours: d.hours,
  minutes: d.minutes,
}));

export const SIM_01_SLEEP_OBSERVATIONS: Observation[] = SLEEP_DAYS_DATA.map(
  (d) => ({
    observationId: `obs-sim01-sleep-d${d.day}`,
    profileId: SIM_01_PROFILE_ID,
    metricId: 'sleep',
    timing: buildPeriodTiming({
      sleepType: 'main_sleep',
      endingMissionDay: d.day,
      durationMinutes: d.minutes,
      reportedAtUtc: `${d.datePrefix}T07:04:00Z`,
      missionEpochUtc: SIM_01_EPOCH_UTC,
    }),
    recordedAtUtc: `${d.datePrefix}T07:04:00Z`,
    entered: {
      kind: 'sleep_duration',
      durationMinutes: d.minutes,
      reportedNoSleep: false,
      unit: 'min',
    },
    canonical: {
      kind: 'sleep_duration',
      durationMinutes: d.minutes,
      reportedNoSleep: false,
      unit: 'min',
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    method: 'Self-reported',
    context: 'Main sleep',
    provenance: 'self_report',
    quality: 'valid',
    qualityNote: null,
    note: null,
    sourceDraftId: null,
    importBatchId: null,
    correctionHistory: [],
  }),
);

/**
 * SIM-01 starts with 11 committed observations across 5 of 6 types.
 * Glucose stays Not recorded.
 */
export const SIM_01_OBSERVATIONS: Observation[] = [
  ...SIM_01_SLEEP_OBSERVATIONS,
  {
    observationId: 'obs-sim01-hr-01',
    profileId: SIM_01_PROFILE_ID,
    metricId: 'heart_rate',
    timing: buildInstantTiming({
      observedAtUtc: '2026-11-13T07:05:00Z',
      missionEpochUtc: SIM_01_EPOCH_UTC,
    }),
    recordedAtUtc: '2026-11-13T07:05:00Z',
    entered: {
      kind: 'scalar',
      value: 72,
      unit: 'bpm',
      precision: 0,
    },
    canonical: {
      kind: 'scalar',
      value: 72,
      unit: 'bpm',
      precision: 0,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    method: 'Manual pulse count',
    context: 'At rest',
    provenance: 'manual',
    quality: 'valid',
    qualityNote: null,
    note: null,
    sourceDraftId: null,
    importBatchId: null,
    correctionHistory: [],
  },
  {
    observationId: 'obs-sim01-bp-01',
    profileId: SIM_01_PROFILE_ID,
    metricId: 'blood_pressure',
    timing: buildInstantTiming({
      observedAtUtc: '2026-11-13T07:07:00Z',
      missionEpochUtc: SIM_01_EPOCH_UTC,
    }),
    recordedAtUtc: '2026-11-13T07:07:00Z',
    entered: {
      kind: 'blood_pressure',
      systolic: 118,
      diastolic: 76,
      unit: 'mmHg',
      precision: 0,
    },
    canonical: {
      kind: 'blood_pressure',
      systolic: 118,
      diastolic: 76,
      unit: 'mmHg',
      precision: 0,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    method: 'Manual cuff',
    context: 'At rest',
    provenance: 'manual',
    quality: 'valid',
    qualityNote: null,
    note: null,
    sourceDraftId: null,
    importBatchId: null,
    correctionHistory: [],
  },
  {
    observationId: 'obs-sim01-temp-01',
    profileId: SIM_01_PROFILE_ID,
    metricId: 'body_temperature',
    timing: buildInstantTiming({
      observedAtUtc: '2026-11-13T07:12:00Z',
      missionEpochUtc: SIM_01_EPOCH_UTC,
    }),
    recordedAtUtc: '2026-11-13T07:12:00Z',
    entered: {
      kind: 'scalar',
      value: 36.7,
      unit: 'C',
      precision: 1,
    },
    canonical: {
      kind: 'scalar',
      value: 36.7,
      unit: 'C',
      precision: 1,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    method: 'Oral thermometer',
    context: 'At rest',
    provenance: 'manual',
    quality: 'valid',
    qualityNote: null,
    note: null,
    sourceDraftId: null,
    importBatchId: null,
    correctionHistory: [],
  },
  {
    observationId: 'obs-sim01-mood-01',
    profileId: SIM_01_PROFILE_ID,
    metricId: 'mood',
    timing: buildInstantTiming({
      observedAtUtc: '2026-11-13T07:14:00Z',
      missionEpochUtc: SIM_01_EPOCH_UTC,
    }),
    recordedAtUtc: '2026-11-13T07:14:00Z',
    entered: {
      kind: 'mood_ordinal',
      score: 3,
      label: 'Neutral',
      scaleId: MOOD_SCALE_ID,
      scaleVersion: MOOD_SCALE_VERSION,
      questionText: MOOD_QUESTION_TEXT,
    },
    canonical: {
      kind: 'mood_ordinal',
      score: 3,
      label: 'Neutral',
      scaleId: MOOD_SCALE_ID,
      scaleVersion: MOOD_SCALE_VERSION,
      questionText: MOOD_QUESTION_TEXT,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    method: 'Self-reported',
    context: 'Routine check-in',
    provenance: 'self_report',
    quality: 'valid',
    qualityNote: null,
    note: null,
    sourceDraftId: null,
    importBatchId: null,
    correctionHistory: [],
  },
];

export const SIM_01_REFERENCES: PersonalReference[] = [
  {
    referenceId: 'demo-ref-sleep-v1',
    profileId: SIM_01_PROFILE_ID,
    metricId: 'sleep',
    version: 1,
    provenance: 'entered_preflight',
    method: 'Self-reported',
    context: 'Main sleep',
    unit: 'min',
    value: {
      kind: 'sleep_duration',
      durationMinutes: 444, // 7h 24m = 7.4h
    },
    sampleCount: 1,
    distinctObservedDays: 1,
    selectedObservationIds: [],
    ambiguousDays: [],
    status: 'active',
    locked: true,
    unavailableReason: null,
    createdAtUtc: '2026-10-03T00:00:00Z',
    label: 'Entered preflight · Version 1',
  },
  {
    referenceId: 'demo-ref-hr-v1',
    profileId: SIM_01_PROFILE_ID,
    metricId: 'heart_rate',
    version: 1,
    provenance: 'entered_preflight',
    method: 'Manual pulse count',
    context: 'At rest',
    unit: 'bpm',
    value: {
      kind: 'scalar',
      value: 64,
    },
    sampleCount: 1,
    distinctObservedDays: 1,
    selectedObservationIds: [],
    ambiguousDays: [],
    status: 'active',
    locked: true,
    unavailableReason: null,
    createdAtUtc: '2026-10-03T00:00:00Z',
    label: 'Entered preflight · Version 1',
  },
];

export const SIM_01_INSIGHTS: Insight[] = [
  buildSleepInsight({
    observation: SIM_01_SLEEP_OBSERVATIONS[SIM_01_SLEEP_OBSERVATIONS.length - 1]!,
    reference: SIM_01_REFERENCES[0]!,
    createdAtUtc: SIM_01_SNAPSHOT_UTC,
  })!,
];

/**
 * Optional CI-02 blood pressure draft at Day 42 07:18 UTC (uncommitted).
 * Preserves prior 07:07 BP entry in the log until explicitly committed.
 */
export const SIM_01_OPTIONAL_BP_DRAFT: CheckInDraft = {
  draftId: 'draft-sim01-ci02-bp',
  profileId: SIM_01_PROFILE_ID,
  mode: 'demo',
  metricId: 'blood_pressure',
  stage: 'record',
  rawFields: {
    primary: '118',
    secondary: '76',
    moodScore: null,
  },
  selectedUnit: 'mmHg',
  rawObservedTimeText: 'Day 42 · 07:18',
  observedMissionDay: 42,
  observedTimeHHMM: '07:18',
  observedAtUtc: '2026-11-13T07:18:00Z',
  missionEpochUtc: SIM_01_EPOCH_UTC,
  originalTimezone: 'UTC',
  method: 'Not specified',
  context: 'At rest',
  provenance: 'manual',
  note: '',
  validationState: {
    valid: true,
    errors: {},
    firstInvalidField: null,
    announcement: null,
  },
  normalizedCandidate: {
    kind: 'blood_pressure',
    systolic: 118,
    diastolic: 76,
    unit: 'mmHg',
    precision: 0,
    conversionVersion: CONVERSION_RULE_VERSION,
  },
  conversionVersion: CONVERSION_RULE_VERSION,
  retentionStatus: 'retained',
  commitStatus: 'uncommitted',
  committedObservationId: null,
  createdAtUtc: '2026-11-13T07:18:00Z',
  updatedAtUtc: '2026-11-13T07:18:00Z',
};

/**
 * MF-01..MF-05 separate pre-commit measurement fixtures from MEASUREMENT-FORMS.md.
 * Each has its own pre-commit snapshot context so opening a fixture never mutates SIM-01.
 */
export interface MeasurementFixtureCase {
  fixtureId: 'MF-01' | 'MF-02' | 'MF-03' | 'MF-04' | 'MF-05';
  description: string;
  snapshotUtc: string;
  priorObservations: Observation[];
  draft: CheckInDraft;
}

export const MF_01_FIXTURE: MeasurementFixtureCase = {
  fixtureId: 'MF-01',
  description: 'Resting HR 72 bpm, method Not specified, At rest, observed day 42 07:18',
  snapshotUtc: '2026-11-13T07:18:00Z',
  priorObservations: SIM_01_OBSERVATIONS,
  draft: {
    draftId: 'draft-mf01-hr',
    profileId: 'sim-mf-01',
    mode: 'demo',
    metricId: 'heart_rate',
    stage: 'record',
    rawFields: { primary: '72', moodScore: null },
    selectedUnit: 'bpm',
    rawObservedTimeText: 'Day 42 · 07:18',
    observedMissionDay: 42,
    observedTimeHHMM: '07:18',
    observedAtUtc: '2026-11-13T07:18:00Z',
    missionEpochUtc: SIM_01_EPOCH_UTC,
    originalTimezone: 'UTC',
    method: 'Not specified',
    context: 'At rest',
    provenance: 'manual',
    note: '',
    validationState: { valid: true, errors: {}, firstInvalidField: null, announcement: null },
    normalizedCandidate: {
      kind: 'scalar',
      value: 72,
      unit: 'bpm',
      precision: 0,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    conversionVersion: CONVERSION_RULE_VERSION,
    retentionStatus: 'retained',
    commitStatus: 'uncommitted',
    committedObservationId: null,
    createdAtUtc: '2026-11-13T07:18:00Z',
    updatedAtUtc: '2026-11-13T07:18:00Z',
  },
};

export const MF_02_FIXTURE: MeasurementFixtureCase = {
  fixtureId: 'MF-02',
  description: 'Glucose 5.4 mmol/L, method/context Not specified, observed day 42 07:18',
  snapshotUtc: '2026-11-13T07:18:00Z',
  priorObservations: SIM_01_OBSERVATIONS,
  draft: {
    draftId: 'draft-mf02-glucose',
    profileId: 'sim-mf-02',
    mode: 'demo',
    metricId: 'blood_glucose',
    stage: 'record',
    rawFields: { primary: '5.4', moodScore: null },
    selectedUnit: 'mmol/L',
    rawObservedTimeText: 'Day 42 · 07:18',
    observedMissionDay: 42,
    observedTimeHHMM: '07:18',
    observedAtUtc: '2026-11-13T07:18:00Z',
    missionEpochUtc: SIM_01_EPOCH_UTC,
    originalTimezone: 'UTC',
    method: 'Not specified',
    context: 'Not specified',
    provenance: 'manual',
    note: '',
    validationState: { valid: true, errors: {}, firstInvalidField: null, announcement: null },
    normalizedCandidate: {
      kind: 'scalar',
      value: 97.308,
      unit: 'mg/dL',
      precision: 3,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    conversionVersion: CONVERSION_RULE_VERSION,
    retentionStatus: 'retained',
    commitStatus: 'uncommitted',
    committedObservationId: null,
    createdAtUtc: '2026-11-13T07:18:00Z',
    updatedAtUtc: '2026-11-13T07:18:00Z',
  },
};

export const MF_03_FIXTURE: MeasurementFixtureCase = {
  fixtureId: 'MF-03',
  description: 'Temperature 36.7 °C, method/context Not specified, observed day 42 07:18',
  snapshotUtc: '2026-11-13T07:18:00Z',
  priorObservations: SIM_01_OBSERVATIONS,
  draft: {
    draftId: 'draft-mf03-temp',
    profileId: 'sim-mf-03',
    mode: 'demo',
    metricId: 'body_temperature',
    stage: 'record',
    rawFields: { primary: '36.7', moodScore: null },
    selectedUnit: 'C',
    rawObservedTimeText: 'Day 42 · 07:18',
    observedMissionDay: 42,
    observedTimeHHMM: '07:18',
    observedAtUtc: '2026-11-13T07:18:00Z',
    missionEpochUtc: SIM_01_EPOCH_UTC,
    originalTimezone: 'UTC',
    method: 'Not specified',
    context: 'Not specified',
    provenance: 'manual',
    note: '',
    validationState: { valid: true, errors: {}, firstInvalidField: null, announcement: null },
    normalizedCandidate: {
      kind: 'scalar',
      value: 36.7,
      unit: 'C',
      precision: 1,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    conversionVersion: CONVERSION_RULE_VERSION,
    retentionStatus: 'retained',
    commitStatus: 'uncommitted',
    committedObservationId: null,
    createdAtUtc: '2026-11-13T07:18:00Z',
    updatedAtUtc: '2026-11-13T07:18:00Z',
  },
};

/**
 * MF-04 uses the earlier 07:04 snapshot before day 42 sleep and later 07:05–07:18
 * observations have been logged; previous main sleep is day 41 = 6h 12m.
 */
export const MF_04_FIXTURE: MeasurementFixtureCase = {
  fixtureId: 'MF-04',
  description: 'Sleep 5h 48m = 348 min, Main sleep, ending day 42, reported 07:04',
  snapshotUtc: '2026-11-13T07:04:00Z',
  priorObservations: SIM_01_SLEEP_OBSERVATIONS.slice(0, 6), // Days 36–41 only
  draft: {
    draftId: 'draft-mf04-sleep',
    profileId: 'sim-mf-04',
    mode: 'demo',
    metricId: 'sleep',
    stage: 'record',
    rawFields: {
      primary: '',
      hours: '5',
      minutes: '48',
      moodScore: null,
      sleepType: 'main_sleep',
      endingMissionDay: '42',
      hasSleepWindow: false,
    },
    selectedUnit: 'min',
    rawObservedTimeText: 'Day 42 · 07:04',
    observedMissionDay: 42,
    observedTimeHHMM: '07:04',
    observedAtUtc: '2026-11-13T07:04:00Z',
    missionEpochUtc: SIM_01_EPOCH_UTC,
    originalTimezone: 'UTC',
    method: 'Self-reported',
    context: 'Main sleep',
    provenance: 'self_report',
    note: '',
    validationState: { valid: true, errors: {}, firstInvalidField: null, announcement: null },
    normalizedCandidate: {
      kind: 'sleep_duration',
      durationMinutes: 348,
      reportedNoSleep: false,
      unit: 'min',
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    conversionVersion: CONVERSION_RULE_VERSION,
    retentionStatus: 'retained',
    commitStatus: 'uncommitted',
    committedObservationId: null,
    createdAtUtc: '2026-11-13T07:04:00Z',
    updatedAtUtc: '2026-11-13T07:04:00Z',
  },
};

export const MF_05_FIXTURE: MeasurementFixtureCase = {
  fixtureId: 'MF-05',
  description: 'Mood 3/5 Neutral, crewsignal-mood-v1, observed day 42 07:18',
  snapshotUtc: '2026-11-13T07:18:00Z',
  priorObservations: SIM_01_OBSERVATIONS,
  draft: {
    draftId: 'draft-mf05-mood',
    profileId: 'sim-mf-05',
    mode: 'demo',
    metricId: 'mood',
    stage: 'record',
    rawFields: { primary: '', moodScore: 3 },
    selectedUnit: 'ordinal_1_5',
    rawObservedTimeText: 'Day 42 · 07:18',
    observedMissionDay: 42,
    observedTimeHHMM: '07:18',
    observedAtUtc: '2026-11-13T07:18:00Z',
    missionEpochUtc: SIM_01_EPOCH_UTC,
    originalTimezone: 'UTC',
    method: 'Self-reported',
    context: 'Routine check-in',
    provenance: 'self_report',
    note: '',
    validationState: { valid: true, errors: {}, firstInvalidField: null, announcement: null },
    normalizedCandidate: {
      kind: 'mood_ordinal',
      score: 3,
      label: 'Neutral',
      scaleId: MOOD_SCALE_ID,
      scaleVersion: MOOD_SCALE_VERSION,
      questionText: MOOD_QUESTION_TEXT,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    conversionVersion: CONVERSION_RULE_VERSION,
    retentionStatus: 'retained',
    commitStatus: 'uncommitted',
    committedObservationId: null,
    createdAtUtc: '2026-11-13T07:18:00Z',
    updatedAtUtc: '2026-11-13T07:18:00Z',
  },
};

export const MF_FIXTURES: readonly MeasurementFixtureCase[] = [
  MF_01_FIXTURE,
  MF_02_FIXTURE,
  MF_03_FIXTURE,
  MF_04_FIXTURE,
  MF_05_FIXTURE,
];

/**
 * SIM-SCHEDULE: isolated schedule fixture with BP Day 41 05:00 and configured 24h interval,
 * yielding 26h 18m age at snapshot Day 42 07:18.
 */
export const SIM_SCHEDULE_PROFILE: ProfileConfig = {
  profileId: 'sim-schedule-01',
  label: 'Schedule example',
  alias: 'SIM-SCHEDULE',
  mode: 'demo',
  scenarioId: 'SIM-SCHEDULE',
  missionName: 'Transit habitat',
  missionEpochUtc: SIM_01_EPOCH_UTC,
  displayTimezone: 'UTC',
  snapshotUtc: SIM_01_SNAPSHOT_UTC,
  createdAtUtc: '2026-10-03T00:00:00Z',
  clockVersion: 1,
  schedules: {
    heart_rate: null,
    blood_pressure: {
      enabled: true,
      intervalHours: 24,
      configuredAtUtc: '2026-11-11T00:00:00Z',
    },
    blood_glucose: null,
    body_temperature: null,
    sleep: null,
    mood: null,
  },
};

export const SIM_SCHEDULE_OBSERVATIONS: Observation[] = [
  {
    observationId: 'obs-simsched-bp-01',
    profileId: 'sim-schedule-01',
    metricId: 'blood_pressure',
    timing: buildInstantTiming({
      observedAtUtc: '2026-11-12T05:00:00Z',
      missionEpochUtc: SIM_01_EPOCH_UTC,
    }),
    recordedAtUtc: '2026-11-12T05:00:00Z',
    entered: {
      kind: 'blood_pressure',
      systolic: 118,
      diastolic: 76,
      unit: 'mmHg',
      precision: 0,
    },
    canonical: {
      kind: 'blood_pressure',
      systolic: 118,
      diastolic: 76,
      unit: 'mmHg',
      precision: 0,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    method: 'Manual cuff',
    context: 'At rest',
    provenance: 'manual',
    quality: 'valid',
    qualityNote: null,
    note: null,
    sourceDraftId: null,
    importBatchId: null,
    correctionHistory: [],
  },
];

/**
 * SIM-EMPTY: blank personal-mode profile starter with zero observations and zero references.
 */
export const SIM_EMPTY_PROFILE: ProfileConfig = {
  profileId: 'personal-empty-01',
  label: 'Crew profile A',
  alias: null,
  mode: 'personal',
  scenarioId: null,
  missionName: 'Personal log',
  missionEpochUtc: '2026-11-13T00:00:00Z',
  displayTimezone: 'UTC',
  snapshotUtc: null,
  createdAtUtc: '2026-11-13T00:00:00Z',
  clockVersion: 1,
  schedules: {
    heart_rate: null,
    blood_pressure: null,
    blood_glucose: null,
    body_temperature: null,
    sleep: null,
    mood: null,
  },
};

/**
 * Exact 5-row CSV review fixture from STATE-CONTRACTS.md:
 * 1. Valid older HR day 40 / 68 bpm
 * 2. Valid older temperature day 41 / 36.6 C
 * 3. Duplicate BP 118/76 matching obs-sim01-bp-01
 * 4. Conflicting BP 120/78 for obs-sim01-bp-01
 * 5. Rejected glucose row with unsupported unit "mg"
 */
export const CSV_REVIEW_FIXTURE_ROWS: ReadonlyArray<Record<string, string>> = [
  {
    observation_id: 'obs-csv-hr-d40',
    metric_id: 'heart_rate',
    timing_kind: 'instant',
    observed_at_utc: '2026-11-11T07:03:00Z',
    mission_day: '40',
    sleep_type: '',
    ending_mission_day: '',
    duration_minutes: '',
    sleep_window_start_utc: '',
    sleep_window_end_utc: '',
    reported_at_utc: '',
    value: '68',
    secondary_value: '',
    unit: 'bpm',
    method: 'Manual pulse count',
    context: 'At rest',
    provenance: 'csv_import',
    notes: '',
  },
  {
    observation_id: 'obs-csv-temp-d41',
    metric_id: 'body_temperature',
    timing_kind: 'instant',
    observed_at_utc: '2026-11-12T07:10:00Z',
    mission_day: '41',
    sleep_type: '',
    ending_mission_day: '',
    duration_minutes: '',
    sleep_window_start_utc: '',
    sleep_window_end_utc: '',
    reported_at_utc: '',
    value: '36.6',
    secondary_value: '',
    unit: 'C',
    method: 'Oral thermometer',
    context: 'At rest',
    provenance: 'csv_import',
    notes: '',
  },
  {
    observation_id: 'obs-sim01-bp-01',
    metric_id: 'blood_pressure',
    timing_kind: 'instant',
    observed_at_utc: '2026-11-13T07:07:00Z',
    mission_day: '42',
    sleep_type: '',
    ending_mission_day: '',
    duration_minutes: '',
    sleep_window_start_utc: '',
    sleep_window_end_utc: '',
    reported_at_utc: '',
    value: '118',
    secondary_value: '76',
    unit: 'mmHg',
    method: 'Manual cuff',
    context: 'At rest',
    provenance: 'csv_import',
    notes: '',
  },
  {
    observation_id: 'obs-sim01-bp-01',
    metric_id: 'blood_pressure',
    timing_kind: 'instant',
    observed_at_utc: '2026-11-13T07:07:00Z',
    mission_day: '42',
    sleep_type: '',
    ending_mission_day: '',
    duration_minutes: '',
    sleep_window_start_utc: '',
    sleep_window_end_utc: '',
    reported_at_utc: '',
    value: '120',
    secondary_value: '78',
    unit: 'mmHg',
    method: 'Manual cuff',
    context: 'At rest',
    provenance: 'csv_import',
    notes: '',
  },
  {
    observation_id: 'obs-csv-glu-rejected',
    metric_id: 'blood_glucose',
    timing_kind: 'instant',
    observed_at_utc: '2026-11-13T07:15:00Z',
    mission_day: '42',
    sleep_type: '',
    ending_mission_day: '',
    duration_minutes: '',
    sleep_window_start_utc: '',
    sleep_window_end_utc: '',
    reported_at_utc: '',
    value: '5.4',
    secondary_value: '',
    unit: 'mg',
    method: 'Not specified',
    context: 'Not specified',
    provenance: 'csv_import',
    notes: '',
  },
];

export const CSV_REVIEW_FIXTURE_CSV: string = [
  CSV_TEMPLATE_COLUMNS.join(','),
  ...CSV_REVIEW_FIXTURE_ROWS.map((r) =>
    CSV_TEMPLATE_COLUMNS.map((col) => r[col] ?? '').join(','),
  ),
].join('\n') + '\n';

export const EXAMPLE_REPORT_BUNDLE: ReportBundle = buildReportBundle({
  profile: SIM_01_PROFILE,
  observations: SIM_01_OBSERVATIONS,
  references: SIM_01_REFERENCES,
  startDay: 36,
  endDay: 42,
  generatedAtUtc: SIM_01_SNAPSHOT_UTC,
});

export const EXAMPLE_BACKUP_BUNDLE: BackupBundle = buildBackupBundle({
  confirmedIncludeAllProfileData: true,
  exportedAtUtc: SIM_01_SNAPSHOT_UTC,
  profile: SIM_01_PROFILE,
  preferences: SIM_01_PREFERENCES,
  observations: SIM_01_OBSERVATIONS,
  checkInEvents: [],
  references: SIM_01_REFERENCES,
  insights: SIM_01_INSIGHTS,
});

export const EXAMPLE_DRAFT_RECOVERY_BUNDLE: DraftRecoveryBundle =
  buildDraftRecoveryBundle({
    draft: SIM_01_OPTIONAL_BP_DRAFT,
    profileLabel: SIM_01_PROFILE.label,
    exportedAtUtc: SIM_01_SNAPSHOT_UTC,
    includeNotes: false,
  });

/**
 * Machine-checkable Cross-Platform Acceptance Vectors covering all 11 rows from
 * plan/IMPLEMENTATION-HANDOFF.md.
 */
export const CANONICAL_ACCEPTANCE_VECTORS = {
  schemaVersion: CREWSIGNAL_SCHEMA_VERSION,
  generatedFor: 'CrewSignal v1 Cross-Platform Acceptance Vectors',
  vectors: [
    {
      id: 'V01-sim01-seed',
      name: 'SIM-01 seed',
      epochUtc: SIM_01_EPOCH_UTC,
      snapshotUtc: SIM_01_SNAPSHOT_UTC,
      expectedMissionDay: 42,
      expectedSnapshotDate: '2026-11-13',
      expectedObservationCount: 11,
      expectedCoveredTypes: 5,
      expectedMissingMetric: 'blood_glucose',
    },
    {
      id: 'V02-optional-blood-pressure',
      name: 'Optional blood pressure',
      draftId: SIM_01_OPTIONAL_BP_DRAFT.draftId,
      enteredSystolic: 118,
      enteredDiastolic: 76,
      observedAtUtc: '2026-11-13T07:18:00Z',
      priorLatestBpObservedAtUtc: '2026-11-13T07:07:00Z',
      expectedTotalObservationsAfterCommit: 12,
      expectedCoveredTypesAfterCommit: 5,
      expectedLatestBpTimeAfterCommit: '07:18',
    },
    {
      id: 'V03-commit-interruption',
      name: 'Commit interruption & idempotence',
      draftId: SIM_01_OPTIONAL_BP_DRAFT.draftId,
      expectedRepeatCommitOutcome: 'already_in_log',
      expectedRollbackOutcome: 'confirmed_not_saved',
      expectedStorageFailureOutcome: 'unconfirmed',
    },
    {
      id: 'V04-skip-and-unavailable',
      name: 'Skip or instrument unavailable',
      priorObservationCount: 11,
      priorCoveredTypes: 5,
      expectedSkipWithZeroCommitsText: 'No measurements added in this check-in.',
      expectedSkipWithOneCommitText: '1 measurement added in this check-in.',
    },
    {
      id: 'V05-unit-change',
      name: 'Unit conversion & populated input-unit confirmation',
      glucoseInputMmolL: 5.4,
      expectedGlucoseExactMgDl: 97.308,
      expectedGlucoseApproxMgDl: 97.3,
      temperatureInputCelsius: 36.7,
      expectedTemperatureExactF: 98.06,
      expectedTemperatureRounded1F: 98.1,
      conversionVersion: CONVERSION_RULE_VERSION,
    },
    {
      id: 'V06-sleep-and-mood',
      name: 'Sleep period & custom mood scale',
      sleepDurationMinutes: 348,
      sleepDisplay: '5h 48m',
      sleepEndingDay: 42,
      sleepReportedTimeLabel: '07:04',
      crossingWindowStart: { day: 41, time: '23:00' },
      crossingWindowEnd: { day: 42, time: '05:00' },
      expectedWindowMinutes: 360,
      expectedEstimatedAsleepPreservedMinutes: 348,
      zeroSleepMinutes: 0,
      moodScaleId: MOOD_SCALE_ID,
      moodQuestion: MOOD_QUESTION_TEXT,
    },
    {
      id: 'V07-reference-and-trend',
      name: 'Reference and trend',
      day42SleepMinutes: 348,
      preflightSleepReferenceMinutes: 444,
      expectedDifferenceMinutes: -96,
      expectedDifferenceLabel: '1h 36m below reference',
      sevenDayPlotHours: [7.2, 7.5, 7.1, 6.8, 6.5, 6.2, 5.8],
      thirtyDayRecordedDays: 7,
      thirtyDayGapDays: 23,
    },
    {
      id: 'V08-reports-and-scope',
      name: 'Reports and scope',
      defaultReportDays: { start: 36, end: 42 },
      defaultReportMetrics: ['heart_rate', 'blood_pressure', 'body_temperature', 'sleep'],
      expectedCountBeforeOptionalBp: 10,
      expectedTypesBeforeOptionalBp: 4,
      expectedCountAfterOptionalBp: 11,
      expectedTypesAfterOptionalBp: 4,
      backupKind: 'crewsignal-backup',
      draftRecoveryKind: 'crewsignal-draft-recovery',
      reportKind: 'crewsignal-report',
    },
    {
      id: 'V09-csv-and-restore',
      name: 'CSV 5-row review and restore',
      expectedCsvCounts: {
        total: 5,
        valid: 2,
        duplicate: 1,
        conflict: 1,
        possibleDuplicate: 0,
        rejected: 1,
      },
      expectedDefaultRestoreDestination: 'separate_profile',
    },
    {
      id: 'V10-offline-and-file-outcomes',
      name: 'Offline and file outcomes',
      browserOutcomeLabel: 'Download requested',
      nativeOutcomeLabel: 'File saved',
      helpModeDefault: 'unconfigured',
      helpFixtureBanner: 'Example procedure card · Test fixture',
    },
    {
      id: 'V11-personal-and-appearance',
      name: 'Personal data and appearance',
      personalEmptyObservationCount: 0,
      personalEmptyReferenceCount: 0,
      initialAppearance: 'system',
    },
  ],
} as const;
