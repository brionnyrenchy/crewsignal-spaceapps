import { describe, expect, it, beforeEach } from 'vitest';
import {
  CANONICAL_ACCEPTANCE_VECTORS,
  CONVERSION_RULE_VERSION,
  CSV_REVIEW_FIXTURE_CSV,
  EVIDENCE_REGISTRY,
  EXAMPLE_BACKUP_BUNDLE,
  MF_02_FIXTURE,
  MF_03_FIXTURE,
  SIM_01_OBSERVATIONS,
  SIM_01_OPTIONAL_BP_DRAFT,
  SIM_01_PREFERENCES,
  SIM_01_PROFILE,
  SIM_01_PROFILE_ID,
  SIM_01_REFERENCES,
  SIM_EMPTY_PROFILE,
  SIM_SCHEDULE_PROFILE,
  buildBackupBundle,
  buildDraftRecoveryBundle,
  buildInstantTiming,
  buildReportBundle,
  compareObservationToReference,
  convertGlucose,
  convertTemperature,
  countCoveredMetricTypes,
  createBlankDraft,
  formatDurationHoursMinutes,
  formatObservationDisplay,
  getLatestObservationsByMetric,
  parseAndReconcileCsv,
  validateBackupImport,
  validateDraftForReview,
  validateDraftRecoveryImport,
  validateSleepWindow,
} from '../../src/shared';
import { CrewSignalDatabase } from '../../src/storage/db';
import { newDraftId } from '../../src/state/workingDrafts';
import {
  SimulatedCommitError,
  createRepository,
} from '../../src/storage/repository';

describe('CrewSignal Website Repository & Cross-Platform Vectors', () => {
  let db: CrewSignalDatabase;
  let repo: ReturnType<typeof createRepository>;

  beforeEach(async () => {
    db = new CrewSignalDatabase(`crewsignal_test_${Math.random().toString(36).slice(2)}`);
    repo = createRepository(db);
    await repo.ensureSeeded();
  });

  it('Vector 1: seeds SIM-01 with 11 observations across 5 of 6 metrics and Day 42 07:07 BP', async () => {
    const snap = await repo.loadSnapshot();
    const sim01Obs = snap.observations.filter((o) => o.profileId === SIM_01_PROFILE_ID);
    expect(sim01Obs).toHaveLength(
      CANONICAL_ACCEPTANCE_VECTORS.vectors[0]!.expectedObservationCount!,
    );
    expect(countCoveredMetricTypes(sim01Obs)).toBe(5);
    const latest = getLatestObservationsByMetric(sim01Obs);
    expect(latest.blood_glucose).toBeNull();
    expect(latest.blood_pressure?.entered.kind).toBe('blood_pressure');
    if (latest.blood_pressure?.entered.kind === 'blood_pressure') {
      expect(latest.blood_pressure.entered.systolic).toBe(118);
      expect(latest.blood_pressure.entered.diastolic).toBe(76);
    }
    expect(snap.sources.length).toBe(Object.keys(EVIDENCE_REGISTRY).length);
  });

  it('Vector 2: commits Day 42 07:18 BP cleanly -> 12 observations while keeping coverage at 5 of 6', async () => {
    const draft = { ...SIM_01_OPTIONAL_BP_DRAFT };
    await repo.saveDraftAtomically(draft);
    const outcome = await repo.commitDraftAtomically(draft, '2026-11-13T07:18:10Z');
    expect(outcome.outcome).toBe('inserted');
    expect(outcome.receiptTitle).toBe('Added to your log');
    expect(outcome.receiptSubtitle).toBe('Stored on this device');

    const snap = await repo.loadSnapshot();
    const sim01Obs = snap.observations.filter((o) => o.profileId === SIM_01_PROFILE_ID);
    expect(sim01Obs).toHaveLength(12);
    expect(countCoveredMetricTypes(sim01Obs)).toBe(5);
    expect(snap.drafts.filter((d) => d.draftId === draft.draftId)).toHaveLength(0);
  });

  it('Vector 3: atomic rollback preserves draft; lost ack is idempotent & checks storage honestly', async () => {
    const draft = { ...SIM_01_OPTIONAL_BP_DRAFT, draftId: 'draft-v3-bp' };
    await repo.saveDraftAtomically(draft);

    // 1. Atomic rollback (ER-02)
    repo.setFaultSimulation({ failCommitRollback: true });
    await expect(repo.commitDraftAtomically(draft)).rejects.toThrow(/preserved/i);
    let snap = await repo.loadSnapshot();
    expect(snap.observations.filter((o) => o.profileId === SIM_01_PROFILE_ID)).toHaveLength(11);
    expect(snap.drafts.some((d) => d.draftId === 'draft-v3-bp')).toBe(true);

    // 2. Retry succeeds then lost-ack detects already_in_log (no duplicate)
    repo.setFaultSimulation({
      failCommitRollback: false,
      failCommitAckAfterWrite: true,
      failPostCommitRead: false,
    });
    await expect(repo.commitDraftAtomically(draft)).rejects.toBeInstanceOf(
      SimulatedCommitError,
    );
    const check = await repo.verifyDraftCommitStatus({
      draftId: 'draft-v3-bp',
      profileId: SIM_01_PROFILE_ID,
    });
    expect(check.status).toBe('already_in_log');
    expect(check.heading).toBe('Already in your log');

    // Re-committing same draft identity must NEVER duplicate
    repo.setFaultSimulation({ failCommitAckAfterWrite: false });
    const repeat = await repo.commitDraftAtomically(draft);
    expect(repeat.outcome).toBe('already_in_log');
    snap = await repo.loadSnapshot();
    expect(snap.observations.filter((o) => o.profileId === SIM_01_PROFILE_ID)).toHaveLength(12);

    // 3. Post-commit verification read failure -> unconfirmed (C09)
    repo.setFaultSimulation({ failPostCommitRead: true });
    const unconfirmed = await repo.verifyDraftCommitStatus({
      draftId: 'draft-unknown',
      profileId: SIM_01_PROFILE_ID,
    });
    expect(unconfirmed.status).toBe('unconfirmed');
    expect(unconfirmed.heading).toBe('Addition unconfirmed');
  });

  it('Vector 4: measurement_unavailable keeps draft; skip records accurate count', async () => {
    const draft = { ...SIM_01_OPTIONAL_BP_DRAFT, draftId: 'draft-kept' };
    await repo.saveDraftAtomically(draft);
    await repo.recordWorkflowEventAtomically({
      profileId: SIM_01_PROFILE_ID,
      eventType: 'measurement_unavailable',
      metricId: 'blood_pressure',
      reason: 'Cuff recharging',
      attemptedAtUtc: '2026-11-13T07:19:00Z',
      attemptedMissionDay: 42,
      attemptedTimeLabel: '07:19',
      missionEpochUtc: SIM_01_PROFILE.missionEpochUtc,
      keptDraftId: draft.draftId,
      committedCountInSession: 0,
    });
    const snap = await repo.loadSnapshot();
    expect(snap.drafts.some((d) => d.draftId === 'draft-kept')).toBe(true);
    expect(snap.observations.filter((o) => o.profileId === SIM_01_PROFILE_ID)).toHaveLength(11);
  });

  it('Vector 5: preserves CDC 18.02 glucose & NIST temperature conversions cleanly', () => {
    const glu = convertGlucose(5.4, 'mmol/L', 'mg/dL');
    expect(glu.exact).toBe(97.308);
    expect(glu.rounded1).toBe(97.3);
    expect(glu.conversionVersion).toBe(CONVERSION_RULE_VERSION);

    const temp = convertTemperature(36.7, 'C', 'F');
    expect(temp.exact).toBe(98.06);
    expect(temp.rounded1).toBe(98.1);

    const gluObs = formatObservationDisplay(
      {
        observationId: 'obs-glu',
        profileId: SIM_01_PROFILE_ID,
        metricId: 'blood_glucose',
        timing: buildInstantTiming({
          observedAtUtc: '2026-11-13T07:18:00Z',
          missionEpochUtc: SIM_01_PROFILE.missionEpochUtc,
        }),
        recordedAtUtc: '2026-11-13T07:18:00Z',
        entered: MF_02_FIXTURE.draft.normalizedCandidate!,
        canonical: MF_02_FIXTURE.draft.normalizedCandidate!,
        method: 'Not specified',
        context: 'Not specified',
        provenance: 'manual',
        quality: 'valid',
        qualityNote: null,
        note: null,
        sourceDraftId: null,
        importBatchId: null,
        correctionHistory: [],
      },
      { blood_glucose: 'mmol/L', body_temperature: 'F' },
    );
    expect(gluObs).toBeDefined();
    expect(MF_03_FIXTURE.draft.rawFields.primary).toBe('36.7');
  });

  it('Vector 6 & 7: sleep period crossing midnight preserves duration, 0h 0m flags no sleep, ref diff = 1h 36m below', () => {
    const win = validateSleepWindow({
      missionEpochUtc: SIM_01_PROFILE.missionEpochUtc,
      startMissionDay: 41,
      startTimeHHMM: '23:00',
      endMissionDay: 42,
      endTimeHHMM: '05:00',
    });
    expect(win.valid).toBe(true);
    expect(win.windowMinutes).toBe(360);

    // 7h 06m padded sleep formatting regression
    const day38Sleep = SIM_01_OBSERVATIONS.find(
      (o) => o.observationId === 'obs-sim01-sleep-d38',
    )!;
    const fmt38 = formatObservationDisplay(day38Sleep, SIM_01_PREFERENCES.displayUnits);
    expect(fmt38.primaryText).toBe('7h 06m');

    const zeroDraft = createBlankDraft({
      draftId: 'd-zero',
      profileId: SIM_01_PROFILE_ID,
      mode: 'demo',
      metricId: 'sleep',
      missionEpochUtc: SIM_01_PROFILE.missionEpochUtc,
      proposedMissionDay: 42,
      proposedTimeHHMM: '07:04',
      nowUtc: '2026-11-13T07:04:00Z',
    });
    zeroDraft.rawFields.hours = '0';
    zeroDraft.rawFields.minutes = '0';
    const validatedZero = validateDraftForReview(zeroDraft);
    expect(validatedZero.validationState.valid).toBe(true);
    expect(validatedZero.canonical?.kind).toBe('sleep_duration');
    if (validatedZero.canonical?.kind === 'sleep_duration') {
      expect(validatedZero.canonical.reportedNoSleep).toBe(true);
    }

    const day42Sleep = SIM_01_OBSERVATIONS.find(
      (o) => o.observationId === 'obs-sim01-sleep-d42',
    )!;
    const sleepRef = SIM_01_REFERENCES[0]!;
    const cmp = compareObservationToReference(day42Sleep, sleepRef);
    expect(cmp.comparisonAvailable).toBe(true);
    expect(cmp.deltaNumeric).toBe(-96);
    expect(cmp.differenceText).toBe('1h 36m below reference');
    expect(formatDurationHoursMinutes(348)).toBe('5h 48m');
  });

  it('Vector 8 & 9: ReportBundle counts 10->11 across 4 default types, CSV reconciles 5 rows (2 valid, 1 dup, 1 conflict, 1 rejected)', async () => {
    const before = buildReportBundle({
      profile: SIM_01_PROFILE,
      observations: SIM_01_OBSERVATIONS,
      references: SIM_01_REFERENCES,
      startDay: 36,
      endDay: 42,
      generatedAtUtc: '2026-11-13T07:18:00Z',
    });
    expect(before.totalObservations).toBe(10);
    expect(before.includedTypesCount).toBe(4);
    expect(before.includedMetricIds).not.toContain('mood');

    await repo.commitDraftAtomically(
      { ...SIM_01_OPTIONAL_BP_DRAFT },
      '2026-11-13T07:18:00Z',
    );
    const snap = await repo.loadSnapshot();
    const simObsAfter = snap.observations.filter((o) => o.profileId === SIM_01_PROFILE_ID);

    const after = buildReportBundle({
      profile: SIM_01_PROFILE,
      observations: simObsAfter,
      references: SIM_01_REFERENCES,
      startDay: 36,
      endDay: 42,
      generatedAtUtc: '2026-11-13T07:18:30Z',
    });
    expect(after.totalObservations).toBe(11);
    expect(after.includedTypesCount).toBe(4);

    // CSV 5-row review on clean SIM_01 starter log
    const preview = parseAndReconcileCsv({
      csvText: CSV_REVIEW_FIXTURE_CSV,
      existingObservations: SIM_01_OBSERVATIONS,
      profileId: SIM_01_PROFILE_ID,
      missionEpochUtc: SIM_01_PROFILE.missionEpochUtc,
      importBatchId: 'batch-test',
      nowUtc: '2026-11-13T07:20:00Z',
    });
    expect(preview.counts).toEqual({
      total: 5,
      valid: 2,
      duplicate: 1,
      conflict: 1,
      possibleDuplicate: 0,
      rejected: 1,
    });
  });

  it('Vector 10 & 11: Public web demo rejects personal-mode backup & draft-recovery bundles while allowing synthetic restore to separate profile', async () => {
    const personalBackup = buildBackupBundle({
      confirmedIncludeAllProfileData: true,
      exportedAtUtc: '2026-11-13T07:30:00Z',
      profile: SIM_EMPTY_PROFILE,
      preferences: SIM_01_PREFERENCES,
      observations: [],
      checkInEvents: [],
      references: [],
      insights: [],
    });

    const rejectCheck = validateBackupImport(personalBackup, {
      rejectPersonalInPublicDemo: true,
    });
    expect(rejectCheck.valid).toBe(false);
    expect(rejectCheck.error).toMatch(/Personal-mode backups cannot be restored/i);

    const personalDraftRecovery = buildDraftRecoveryBundle({
      draft: {
        ...SIM_01_OPTIONAL_BP_DRAFT,
        mode: 'personal',
        profileId: SIM_EMPTY_PROFILE.profileId,
      },
      profileLabel: SIM_EMPTY_PROFILE.label,
      exportedAtUtc: '2026-11-13T07:30:00Z',
    });
    const draftCheck = validateDraftRecoveryImport(personalDraftRecovery, {
      existingObservations: SIM_01_OBSERVATIONS,
      rejectPersonalInPublicDemo: true,
    });
    expect(draftCheck.valid).toBe(false);
    expect(draftCheck.status).toBe('rejected');

    // Demo backup restores into separate profile by default
    const restored = await repo.restoreBackupAtomically({
      rawInput: EXAMPLE_BACKUP_BUNDLE,
      destination: 'separate_profile',
    });
    expect(restored.profile.profileId).not.toBe(SIM_01_PROFILE_ID);
    expect(restored.profile.mode).toBe('demo');
    expect(SIM_SCHEDULE_PROFILE.schedules.blood_pressure?.intervalHours).toBe(24);
  });

  it('Review P1: consecutive check-ins get distinct draft IDs; retrying the second keeps 13', async () => {
    const base = { ...SIM_01_OPTIONAL_BP_DRAFT };
    const first = { ...base, draftId: newDraftId(SIM_01_PROFILE_ID, 'blood_pressure') };
    const second = { ...base, draftId: newDraftId(SIM_01_PROFILE_ID, 'blood_pressure') };
    expect(first.draftId).not.toBe(second.draftId);

    await repo.saveDraftAtomically(first);
    expect((await repo.commitDraftAtomically(first)).outcome).toBe('inserted');
    await repo.saveDraftAtomically(second);
    expect((await repo.commitDraftAtomically(second)).outcome).toBe('inserted');
    const retry = await repo.commitDraftAtomically(second);
    expect(retry.outcome).not.toBe('inserted');

    const snap = await repo.loadSnapshot();
    expect(snap.observations.filter((o) => o.profileId === SIM_01_PROFILE_ID)).toHaveLength(13);
  });

  it('Review P1: saving a draft for one measurement keeps the retained draft of another', async () => {
    const bp = { ...SIM_01_OPTIONAL_BP_DRAFT, draftId: newDraftId(SIM_01_PROFILE_ID, 'blood_pressure') };
    const hr = createBlankDraft({
      draftId: newDraftId(SIM_01_PROFILE_ID, 'heart_rate'),
      profileId: SIM_01_PROFILE_ID,
      mode: 'demo',
      metricId: 'heart_rate',
      missionEpochUtc: bp.missionEpochUtc,
      proposedMissionDay: 42,
      proposedTimeHHMM: '07:18',
      nowUtc: '2026-11-13T07:18:00Z',
    });
    await repo.saveDraftAtomically(bp);
    await repo.saveDraftAtomically({ ...hr, rawFields: { ...hr.rawFields, primary: '66' } });
    // A newer draft for the same measurement replaces the older one.
    const bp2 = { ...bp, draftId: newDraftId(SIM_01_PROFILE_ID, 'blood_pressure') };
    await repo.saveDraftAtomically(bp2);
    const drafts = (await repo.loadSnapshot()).drafts.filter((d) => d.profileId === SIM_01_PROFILE_ID);
    expect(drafts.map((d) => d.metricId).sort()).toEqual(['blood_pressure', 'heart_rate']);
    expect(drafts.find((d) => d.metricId === 'blood_pressure')?.draftId).toBe(bp2.draftId);
  });

  it('Review P1: the first eligible fallback is persisted with its representative IDs and stays locked', async () => {
    // SIM-01 without its entered-preflight sleep reference: 7 eligible Main sleep days.
    await db.references.delete('demo-ref-sleep-v1');
    await Promise.all([repo.lockEligibleFallbackReferences(), repo.lockEligibleFallbackReferences()]);
    const sleepRefs = async (d: CrewSignalDatabase) =>
      (await d.references.toArray()).filter(
        (r) => r.profileId === SIM_01_PROFILE_ID && r.metricId === 'sleep',
      );
    const [locked] = await sleepRefs(db);
    expect(await sleepRefs(db)).toHaveLength(1);
    expect(locked!.provenance).toBe('seven_day_fallback_median');
    expect(locked!.value).toEqual({ kind: 'sleep_duration', durationMinutes: 408 });
    expect(locked!.selectedObservationIds).toHaveLength(7);

    // A later observation and an earlier import do not move the lock.
    const template = SIM_01_OBSERVATIONS.find((o) => o.metricId === 'sleep')!;
    const shifted = (id: string, day: number, minutes: number) => ({
      ...template,
      observationId: id,
      timing: { ...template.timing, endingMissionDay: day } as typeof template.timing,
      canonical: { ...template.canonical, durationMinutes: minutes } as typeof template.canonical,
    });
    await db.observations.bulkPut([
      shifted('obs-later-d43', 43, 300),
      shifted('obs-import-d30', 30, 520),
      shifted('obs-import-d31', 31, 515),
    ]);
    await repo.loadSnapshot();
    expect(await sleepRefs(db)).toEqual([locked]);

    // Restart: a fresh connection to the same database keeps the same lock.
    const name = db.name;
    db.close();
    db = new CrewSignalDatabase(name);
    repo = createRepository(db);
    const snap = await repo.loadSnapshot();
    expect(snap.references.filter((r) => r.metricId === 'sleep' && r.profileId === SIM_01_PROFILE_ID)).toEqual([locked]);

    // An explicit update adds an active version 2 and keeps the superseded fallback.
    await repo.createReferenceVersionAtomically({
      profileId: SIM_01_PROFILE_ID,
      metricId: 'sleep',
      provenance: 'user_updated',
      method: 'Self-reported',
      context: 'Main sleep',
      unit: 'min',
      value: { kind: 'sleep_duration', durationMinutes: 420 },
    });
    await repo.loadSnapshot();
    const after = (await sleepRefs(db)).sort((a, b) => a.version - b.version);
    expect(after.map((r) => [r.version, r.status])).toEqual([
      [1, 'superseded'],
      [2, 'active'],
    ]);
    expect(after[0]!.selectedObservationIds).toEqual(locked!.selectedObservationIds);
  });
});
