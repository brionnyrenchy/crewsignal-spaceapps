import { afterEach, describe, expect, test } from '@jest/globals';
import canonicalVectors from '../src/shared/fixtures/canonical-vectors.json';
import {
  CONVERSION_RULE_VERSION,
  CONFIGURED_HELP_TEST_FIXTURE,
  CSV_REVIEW_FIXTURE_CSV,
  DEFAULT_REPORT_METRICS,
  DEFAULT_UNCONFIGURED_HELP,
  EXAMPLE_BACKUP_BUNDLE,
  EXAMPLE_DRAFT_RECOVERY_BUNDLE,
  METRIC_DEFINITIONS,
  MOOD_QUESTION_TEXT,
  MOOD_SCALE_ID,
  SIM_01_OPTIONAL_BP_DRAFT,
  SIM_01_PREFERENCES,
  SIM_01_PROFILE_ID,
  buildPeriodTiming,
  buildReportBundle,
  buildSleepInsight,
  compareObservationToReference,
  computeMissionDay,
  convertGlucose,
  convertTemperature,
  formatDurationHoursMinutes,
  formatSkipOutcomeMessage,
  getObservedMissionDay,
  parseAndReconcileCsv,
  resolveActiveReference,
  validateDraftForReview,
  validateSleepWindow,
} from '../src/shared/src';
import { NodeSqliteDriver } from '../src/storage/nodeDriver';
import { CrewSignalSqliteStore } from '../src/storage/sqliteStore';

function getVector<T = Record<string, unknown>>(id: string): T {
  const match = (canonicalVectors.vectors as Array<{ id: string }>).find((v) => v.id === id);
  if (!match) {
    throw new Error(`Missing canonical vector ${id}`);
  }
  return match as unknown as T;
}

describe('CrewSignal canonical acceptance vectors (V01-V11) on SQLite mobile store', () => {
  const drivers: NodeSqliteDriver[] = [];

  afterEach(async () => {
    while (drivers.length > 0) {
      const d = drivers.pop();
      if (d) await d.close();
    }
  });

  async function bootMobileStore(): Promise<CrewSignalSqliteStore> {
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const store = new CrewSignalSqliteStore(driver);
    await store.initialize();
    return store;
  }

  test('V01-sim01-seed: epoch, Day 42 snapshot, 11 observations, 5 covered types, Blood Glucose Missing', async () => {
    const v01 = getVector<{
      epochUtc: string;
      snapshotUtc: string;
      expectedMissionDay: number;
      expectedObservationCount: number;
      expectedCoveredTypes: number;
      expectedMissingMetric: string;
    }>('V01-sim01-seed');
    const store = await bootMobileStore();
    const snap = await store.loadAppSnapshot();

    expect(computeMissionDay(v01.snapshotUtc, v01.epochUtc)).toBe(v01.expectedMissionDay);
    expect(snap.active.observations).toHaveLength(v01.expectedObservationCount);

    const coveredMetrics = new Set(snap.active.observations.map((o) => o.metricId));
    expect(coveredMetrics.size).toBe(v01.expectedCoveredTypes);
    expect(coveredMetrics.has(v01.expectedMissingMetric as 'blood_glucose')).toBe(false);
  });

  test('V02-optional-blood-pressure & V03-commit-interruption', async () => {
    const v02 = getVector<{
      draftId: string;
      enteredSystolic: number;
      enteredDiastolic: number;
      observedAtUtc: string;
      expectedTotalObservationsAfterCommit: number;
      expectedCoveredTypesAfterCommit: number;
      expectedLatestBpTimeAfterCommit: string;
    }>('V02-optional-blood-pressure');
    const v03 = getVector<{
      expectedRepeatCommitOutcome: string;
    }>('V03-commit-interruption');
    const store = await bootMobileStore();

    const bpDraft = {
      ...SIM_01_OPTIONAL_BP_DRAFT,
      draftId: v02.draftId,
      observedMissionDay: 42,
      observedTimeHHMM: v02.expectedLatestBpTimeAfterCommit,
      rawFields: {
        ...SIM_01_OPTIONAL_BP_DRAFT.rawFields,
        primary: String(v02.enteredSystolic),
        secondary: String(v02.enteredDiastolic),
      },
    };

    const res1 = await store.commitDraftObservation({
      draft: bpDraft,
      committedAtUtc: v02.observedAtUtc,
    });
    expect(res1.outcome).toBe('insert');

    const after = await store.loadAppSnapshot();
    expect(after.active.observations).toHaveLength(v02.expectedTotalObservationsAfterCommit);
    expect(new Set(after.active.observations.map((o) => o.metricId)).size).toBe(
      v02.expectedCoveredTypesAfterCommit,
    );

    const repeat = await store.commitDraftObservation({
      draft: bpDraft,
      committedAtUtc: '2026-11-13T07:19:00Z',
    });
    expect(repeat.outcome).toBe(v03.expectedRepeatCommitOutcome);
  });

  test('V04-skip-and-unavailable exact outcome messages', () => {
    const v04 = getVector<{
      expectedSkipWithZeroCommitsText: string;
      expectedSkipWithOneCommitText: string;
    }>('V04-skip-and-unavailable');
    expect(formatSkipOutcomeMessage(0)).toBe(v04.expectedSkipWithZeroCommitsText);
    expect(formatSkipOutcomeMessage(1)).toBe(v04.expectedSkipWithOneCommitText);
  });

  test('V05-unit-change exact and display conversions', () => {
    const v05 = getVector<{
      glucoseInputMmolL: number;
      expectedGlucoseExactMgDl: number;
      expectedGlucoseApproxMgDl: number;
      temperatureInputCelsius: number;
      expectedTemperatureExactF: number;
      expectedTemperatureRounded1F: number;
      conversionVersion: string;
    }>('V05-unit-change');
    expect(CONVERSION_RULE_VERSION).toBe(v05.conversionVersion);

    const g = convertGlucose(v05.glucoseInputMmolL, 'mmol/L', 'mg/dL');
    expect(g.exact).toBeCloseTo(v05.expectedGlucoseExactMgDl, 3);
    expect(g.rounded1).toBeCloseTo(v05.expectedGlucoseApproxMgDl, 1);

    const t = convertTemperature(v05.temperatureInputCelsius, 'C', 'F');
    expect(t.exact).toBeCloseTo(v05.expectedTemperatureExactF, 2);
    expect(t.rounded1).toBeCloseTo(v05.expectedTemperatureRounded1F, 1);
  });

  test('V06-sleep-and-mood: 5h 48m, 7h 06m zero-padding, midnight window & 0h 0m Reported no sleep, custom mood', async () => {
    const v06 = getVector<{
      sleepDurationMinutes: number;
      sleepDisplay: string;
      sleepEndingDay: number;
      crossingWindowStart: { day: number; time: string };
      crossingWindowEnd: { day: number; time: string };
      expectedWindowMinutes: number;
      zeroSleepMinutes: number;
      moodScaleId: string;
      moodQuestion: string;
    }>('V06-sleep-and-mood');
    const store = await bootMobileStore();
    const snap = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);

    expect(formatDurationHoursMinutes(v06.sleepDurationMinutes)).toBe(v06.sleepDisplay);
    expect(formatDurationHoursMinutes(426, { padMinutes: true })).toBe('7h 06m');
    expect(formatDurationHoursMinutes(v06.zeroSleepMinutes)).toBe('0h 0m');

    const sleepWin = validateSleepWindow({
      missionEpochUtc: snap.profile.missionEpochUtc,
      startMissionDay: v06.crossingWindowStart.day,
      startTimeHHMM: v06.crossingWindowStart.time,
      endMissionDay: v06.crossingWindowEnd.day,
      endTimeHHMM: v06.crossingWindowEnd.time,
    });
    expect(sleepWin.valid).toBe(true);
    expect(sleepWin.windowMinutes).toBe(v06.expectedWindowMinutes);

    const period = buildPeriodTiming({
      missionEpochUtc: snap.profile.missionEpochUtc,
      endingMissionDay: v06.sleepEndingDay,
      reportedAtUtc: '2026-11-13T07:04:00Z',
      sleepType: 'main_sleep',
      durationMinutes: v06.sleepDurationMinutes,
      windowStartUtc: sleepWin.startUtc,
      windowEndUtc: sleepWin.endUtc,
    });
    expect(period.durationMinutes).toBe(v06.sleepDurationMinutes);

    // Zero sleep allowed cleanly as "0" / "0"
    const zeroDraft = {
      ...SIM_01_OPTIONAL_BP_DRAFT,
      draftId: 'draft-sleep-zero',
      metricId: 'sleep' as const,
      selectedUnit: 'h_m' as const,
      method: METRIC_DEFINITIONS.sleep.methodOptions[0]!,
      context: METRIC_DEFINITIONS.sleep.contextOptions[0]!,
      rawFields: {
        primary: '',
        hours: '0',
        minutes: '0',
        moodScore: null,
        sleepType: 'main_sleep' as const,
        endingMissionDay: '42',
        hasSleepWindow: false,
      },
      observedMissionDay: 42,
      observedTimeHHMM: '07:04',
    };
    expect(validateDraftForReview(zeroDraft).validationState.valid).toBe(true);

    expect(MOOD_SCALE_ID).toBe(v06.moodScaleId);
    expect(MOOD_QUESTION_TEXT).toBe(v06.moodQuestion);
  });

  test('V07-reference-and-trend: -96 min / 1h 36m below reference & 7-day / 30-day counts', async () => {
    const v07 = getVector<{
      expectedDifferenceMinutes: number;
      expectedDifferenceLabel: string;
      sevenDayPlotHours: number[];
      thirtyDayRecordedDays: number;
      thirtyDayGapDays: number;
    }>('V07-reference-and-trend');
    const store = await bootMobileStore();
    const snap = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);

    const sleepObs = snap.observations
      .filter((o) => o.metricId === 'sleep')
      .sort((a, b) => getObservedMissionDay(a) - getObservedMissionDay(b));
    const latestSleep = sleepObs[sleepObs.length - 1]!;

    const sleepRef = resolveActiveReference({
      profileId: SIM_01_PROFILE_ID,
      metricId: 'sleep',
      references: snap.references,
      observations: snap.observations,
      referenceMethod: METRIC_DEFINITIONS.sleep.methodOptions[0]!,
      referenceContext: METRIC_DEFINITIONS.sleep.contextOptions[0]!,
      nowUtc: '2026-11-13T07:18:00Z',
    });

    const comp = compareObservationToReference(latestSleep, sleepRef);
    expect(comp.deltaNumeric).toBe(v07.expectedDifferenceMinutes);
    expect(comp.differenceText).toContain(v07.expectedDifferenceLabel);

    const insight = buildSleepInsight({
      observation: latestSleep,
      reference: sleepRef,
      createdAtUtc: '2026-11-13T07:18:00Z',
    });
    expect(insight?.differenceText).toContain(v07.expectedDifferenceLabel);

    const sevenDayHours = sleepObs
      .filter((o) => {
        const d = getObservedMissionDay(o);
        return d >= 36 && d <= 42;
      })
      .map((o) => {
        if (o.canonical.kind !== 'sleep_duration') throw new Error('Expected sleep_duration');
        return Number((o.canonical.durationMinutes / 60).toFixed(1));
      });
    expect(sevenDayHours).toEqual(v07.sevenDayPlotHours);

    const distinct30Days = new Set(
      sleepObs
        .map((o) => getObservedMissionDay(o))
        .filter((d) => d >= 13 && d <= 42),
    ).size;
    expect(distinct30Days).toBe(v07.thirtyDayRecordedDays);
    expect(30 - distinct30Days).toBe(v07.thirtyDayGapDays);
  });

  test('V08-reports-and-scope: live counts 10 -> 11 after optional BP commit', async () => {
    const v08 = getVector<{
      defaultReportDays: { start: number; end: number };
      expectedCountBeforeOptionalBp: number;
      expectedTypesBeforeOptionalBp: number;
      expectedCountAfterOptionalBp: number;
      expectedTypesAfterOptionalBp: number;
      backupKind: string;
      draftRecoveryKind: string;
      reportKind: string;
    }>('V08-reports-and-scope');
    const store = await bootMobileStore();
    const snap1 = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);

    const beforeReport = buildReportBundle({
      profile: snap1.profile,
      observations: snap1.observations,
      references: snap1.references,
      startDay: v08.defaultReportDays.start,
      endDay: v08.defaultReportDays.end,
      selectedMetricIds: DEFAULT_REPORT_METRICS,
      includeMood: false,
      includeNotes: false,
      generatedAtUtc: '2026-11-13T07:18:00Z',
    });
    expect(beforeReport.kind).toBe(v08.reportKind);
    expect(beforeReport.observations).toHaveLength(v08.expectedCountBeforeOptionalBp);
    expect(beforeReport.includedTypesCount).toBe(v08.expectedTypesBeforeOptionalBp);

    await store.commitDraftObservation({
      draft: {
        ...SIM_01_OPTIONAL_BP_DRAFT,
        observedMissionDay: 42,
        observedTimeHHMM: '07:18',
        rawFields: {
          ...SIM_01_OPTIONAL_BP_DRAFT.rawFields,
          primary: '118',
          secondary: '76',
        },
      },
      committedAtUtc: '2026-11-13T07:18:10Z',
    });

    const snap2 = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);
    const afterReport = buildReportBundle({
      profile: snap2.profile,
      observations: snap2.observations,
      references: snap2.references,
      startDay: v08.defaultReportDays.start,
      endDay: v08.defaultReportDays.end,
      selectedMetricIds: DEFAULT_REPORT_METRICS,
      includeMood: false,
      includeNotes: false,
      generatedAtUtc: '2026-11-13T07:18:20Z',
    });
    expect(afterReport.observations).toHaveLength(v08.expectedCountAfterOptionalBp);
    expect(afterReport.includedTypesCount).toBe(v08.expectedTypesAfterOptionalBp);

    expect(EXAMPLE_BACKUP_BUNDLE.kind).toBe(v08.backupKind);
    expect(EXAMPLE_DRAFT_RECOVERY_BUNDLE.kind).toBe(v08.draftRecoveryKind);
  });

  test('V09-csv-and-restore, V10-help-fixture, V11-personal-empty-state', async () => {
    const v09 = getVector<{
      expectedCsvCounts: {
        total: number;
        valid: number;
        duplicate: number;
        conflict: number;
        possibleDuplicate: number;
        rejected: number;
      };
    }>('V09-csv-and-restore');
    const v10 = getVector<{
      helpModeDefault: string;
      helpFixtureBanner: string;
    }>('V10-offline-and-file-outcomes');
    const v11 = getVector<{
      personalEmptyObservationCount: number;
      personalEmptyReferenceCount: number;
      initialAppearance: string;
    }>('V11-personal-and-appearance');
    const store = await bootMobileStore();
    const snap = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);

    const preview = parseAndReconcileCsv({
      csvText: CSV_REVIEW_FIXTURE_CSV,
      existingObservations: snap.observations,
      profileId: SIM_01_PROFILE_ID,
      missionEpochUtc: snap.profile.missionEpochUtc,
      importBatchId: 'batch-vector-check',
      nowUtc: '2026-11-13T07:18:00Z',
    });
    expect(preview.counts).toEqual(v09.expectedCsvCounts);

    expect(DEFAULT_UNCONFIGURED_HELP.mode).toBe(v10.helpModeDefault);
    expect(CONFIGURED_HELP_TEST_FIXTURE.fixtureBanner).toBe(v10.helpFixtureBanner);

    expect(SIM_01_PREFERENCES.appearance).toBe(v11.initialAppearance);
    const personal = await store.createPersonalProfile({
      label: 'Personal Clean Log',
      missionName: 'My Personal Mission',
      missionEpochUtc: '2026-11-01T00:00:00Z',
      nowUtc: '2026-11-13T08:00:00Z',
    });
    const personalSnap = await store.loadProfileSnapshot(personal.profileId);
    expect(personalSnap.observations).toHaveLength(v11.personalEmptyObservationCount);
    expect(personalSnap.references).toHaveLength(v11.personalEmptyReferenceCount);
  });
});
