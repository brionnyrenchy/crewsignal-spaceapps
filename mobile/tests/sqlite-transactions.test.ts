import { afterEach, describe, expect, test } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(target: string, options?: { recursive?: boolean; force?: boolean }): void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('node:os') as { tmpdir(): string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path') as { join(...parts: string[]): string };
import {
  CSV_REVIEW_FIXTURE_CSV,
  EXAMPLE_BACKUP_BUNDLE,
  EXAMPLE_DRAFT_RECOVERY_BUNDLE,
  SIM_01_OBSERVATIONS,
  SIM_01_OPTIONAL_BP_DRAFT,
  SIM_01_PROFILE_ID,
  SIM_01_SNAPSHOT_UTC,
  buildBackupBundle,
  buildDraftRecoveryBundle,
  createBlankDraft,
  parseAndReconcileCsv,
} from '../src/shared/src';
import { NodeSqliteDriver } from '../src/storage/nodeDriver';
import {
  CrewSignalSqliteStore,
  LostCommitAcknowledgementError,
} from '../src/storage/sqliteStore';

describe('CrewSignalSqliteStore ACID transactions & profile scoping', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  async function createInMemoryStore(): Promise<{
    driver: NodeSqliteDriver;
    store: CrewSignalSqliteStore;
  }> {
    const driver = new NodeSqliteDriver(':memory:');
    const store = new CrewSignalSqliteStore(driver);
    await store.initialize();
    cleanups.push(() => driver.close());
    return { driver, store };
  }

  test('commits observation and closes source draft in one atomic transaction with idempotence', async () => {
    const { store } = await createInMemoryStore();
    const initial = await store.loadAppSnapshot();
    expect(initial.active.profile.profileId).toBe(SIM_01_PROFILE_ID);
    expect(initial.active.observations).toHaveLength(11);
    expect(initial.active.drafts.map((d) => d.draftId)).toContain(
      SIM_01_OPTIONAL_BP_DRAFT.draftId,
    );

    const bpDraft = {
      ...SIM_01_OPTIONAL_BP_DRAFT,
      rawFields: {
        ...SIM_01_OPTIONAL_BP_DRAFT.rawFields,
        primary: '118',
        secondary: '76',
      },
      observedMissionDay: 42,
      observedTimeHHMM: '07:18',
    };

    const committed = await store.commitDraftObservation({
      draft: bpDraft,
      committedAtUtc: '2026-11-13T07:18:10Z',
    });

    expect(committed.outcome).toBe('insert');
    expect(committed.observation?.sourceDraftId).toBe(SIM_01_OPTIONAL_BP_DRAFT.draftId);
    expect(committed.observation?.canonical).toMatchObject({
      kind: 'blood_pressure',
      systolic: 118,
      diastolic: 76,
    });

    const afterCommit = await store.loadAppSnapshot();
    expect(afterCommit.active.observations).toHaveLength(12);
    expect(afterCommit.active.drafts).toHaveLength(0);

    // Repeating commit of same draft id returns already_in_log cleanly without creating duplicates
    const repeat = await store.commitDraftObservation({
      draft: bpDraft,
      committedAtUtc: '2026-11-13T07:18:25Z',
    });
    expect(repeat.outcome).toBe('already_in_log');
    expect(repeat.observation?.observationId).toBe(committed.observation?.observationId);

    const afterRepeat = await store.loadAppSnapshot();
    expect(afterRepeat.active.observations).toHaveLength(12);
  });

  test('rolls back failed commit cleanly leaving zero extra observations and retaining source draft', async () => {
    const { store } = await createInMemoryStore();
    const bpDraft = {
      ...SIM_01_OPTIONAL_BP_DRAFT,
      rawFields: {
        ...SIM_01_OPTIONAL_BP_DRAFT.rawFields,
        primary: '122',
        secondary: '78',
      },
    };

    await expect(
      store.commitDraftObservation({
        draft: bpDraft,
        committedAtUtc: '2026-11-13T07:18:10Z',
        simulateFailureMode: 'after_insert_rollback',
      }),
    ).rejects.toThrow(/rollback|interruption/i);

    const afterRollback = await store.loadAppSnapshot();
    expect(afterRollback.active.observations).toHaveLength(11);
    expect(afterRollback.active.drafts.map((d) => d.draftId)).toContain(
      SIM_01_OPTIONAL_BP_DRAFT.draftId,
    );

    const resolution = await store.checkDraftCommitStatus({
      profileId: SIM_01_PROFILE_ID,
      draftId: SIM_01_OPTIONAL_BP_DRAFT.draftId,
    });
    expect(resolution.status).toBe('confirmed_not_saved');
  });

  test('detects lost commit acknowledgement via source_draft_id re-check without duplicating row', async () => {
    const { store } = await createInMemoryStore();
    const bpDraft = {
      ...SIM_01_OPTIONAL_BP_DRAFT,
      rawFields: {
        ...SIM_01_OPTIONAL_BP_DRAFT.rawFields,
        primary: '118',
        secondary: '76',
      },
      observedMissionDay: 42,
      observedTimeHHMM: '07:18',
    };

    await expect(
      store.commitDraftObservation({
        draft: bpDraft,
        committedAtUtc: '2026-11-13T07:18:10Z',
        simulateFailureMode: 'lost_ack',
      }),
    ).rejects.toBeInstanceOf(LostCommitAcknowledgementError);

    // Storage failure simulation yields unconfirmed
    const readFail = await store.checkDraftCommitStatus({
      profileId: SIM_01_PROFILE_ID,
      draftId: bpDraft.draftId,
      simulateStorageReadFailure: true,
    });
    expect(readFail.status).toBe('unconfirmed');

    // Real SQLite query recovers cleanly as already_in_log
    const check = await store.checkDraftCommitStatus({
      profileId: SIM_01_PROFILE_ID,
      draftId: bpDraft.draftId,
    });
    expect(check.status).toBe('already_in_log');
    expect(check.existingObservation?.sourceDraftId).toBe(bpDraft.draftId);

    const snap = await store.loadAppSnapshot();
    expect(snap.active.observations).toHaveLength(12);
    expect(snap.active.drafts).toHaveLength(0);
  });

  test('executes 5-row CSV reconciliation batch atomically with rollback and pair correction history', async () => {
    const { store } = await createInMemoryStore();
    const initialSnap = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);

    const preview = parseAndReconcileCsv({
      csvText: CSV_REVIEW_FIXTURE_CSV,
      existingObservations: initialSnap.observations,
      profileId: SIM_01_PROFILE_ID,
      missionEpochUtc: initialSnap.profile.missionEpochUtc,
      importBatchId: 'batch-preview-01',
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

    const conflictRow = preview.rows.find((r) => r.classification === 'conflict');
    expect(conflictRow).toBeDefined();

    // Unacknowledged exclusions fail validation cleanly without writing
    const missingAck = await store.commitCsvImportBatch({
      profileId: SIM_01_PROFILE_ID,
      preview,
      conflictChoices: { [conflictRow!.observationId]: 'use_imported' },
      possibleDuplicateChoices: {},
      acknowledgedExclusions: false,
      nowUtc: '2026-11-13T07:20:00Z',
      batchId: 'batch-missing-ack',
    });
    expect(missingAck.ready).toBe(false);

    // Simulated mid-batch write error rolls back every row
    await expect(
      store.commitCsvImportBatch({
        profileId: SIM_01_PROFILE_ID,
        preview,
        conflictChoices: { [conflictRow!.observationId]: 'use_imported' },
        possibleDuplicateChoices: {},
        acknowledgedExclusions: true,
        nowUtc: '2026-11-13T07:20:00Z',
        batchId: 'batch-rollback',
        simulateWriteFailure: true,
      }),
    ).rejects.toThrow(/failure/i);

    const afterRollback = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);
    expect(afterRollback.observations).toHaveLength(11);
    expect(afterRollback.importBatchCount).toBe(0);

    // Valid commit updates conflicting BP pair as one unit + preserves prior values in correctionHistory
    const committed = await store.commitCsvImportBatch({
      profileId: SIM_01_PROFILE_ID,
      preview,
      conflictChoices: { [conflictRow!.observationId]: 'use_imported' },
      possibleDuplicateChoices: {},
      acknowledgedExclusions: true,
      nowUtc: '2026-11-13T07:20:00Z',
      batchId: 'batch-commit-01',
    });

    expect(committed.ready).toBe(true);
    expect(committed.insertedCount).toBe(2);
    expect(committed.updatedCount).toBe(1);
    expect(committed.skippedCount).toBe(2); // 1 duplicate + 1 rejected

    const afterBatch = await store.loadProfileSnapshot(SIM_01_PROFILE_ID);
    expect(afterBatch.observations).toHaveLength(13); // 11 + 2 new valid rows (1 updated in place)
    expect(afterBatch.importBatchCount).toBe(1);

    const correctedBp = afterBatch.observations.find(
      (o) =>
        o.metricId === 'blood_pressure' &&
        o.correctionHistory.length > 0,
    );
    expect(correctedBp).toBeDefined();
    expect(correctedBp?.canonical).toMatchObject({
      kind: 'blood_pressure',
      systolic: 120,
      diastolic: 78,
    });
    expect(correctedBp?.correctionHistory[0]?.previousCanonical).toMatchObject({
      kind: 'blood_pressure',
      systolic: 118,
      diastolic: 76,
    });
  });

  test('supports personal profile isolation, scoped demo reset, backup restore confirmation, and file persistence', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crewsignal-mobile-db-'));
    const dbPath = path.join(tmpDir, 'crewsignal.sqlite');
    const driver1 = new NodeSqliteDriver(dbPath);
    const store1 = new CrewSignalSqliteStore(driver1);
    await store1.initialize();

    try {
      // Create blank Personal profile and commit 1 observation to it
      const personal = await store1.createPersonalProfile({
        label: 'Test Crewmember',
        missionName: 'Personal Log',
        missionEpochUtc: '2026-11-01T00:00:00Z',
        nowUtc: '2026-11-13T07:18:00Z',
      });
      const personalSnap = await store1.loadProfileSnapshot(personal.profileId);
      expect(personalSnap.observations).toHaveLength(0);
      expect(personalSnap.references).toHaveLength(0);

      const personalDraft = createBlankDraft({
        draftId: 'draft-personal-hr-1',
        profileId: personal.profileId,
        mode: personal.mode,
        metricId: 'heart_rate',
        missionEpochUtc: personal.missionEpochUtc,
        proposedMissionDay: 13,
        proposedTimeHHMM: '07:19',
        nowUtc: '2026-11-13T07:19:00Z',
      });
      personalDraft.rawFields.primary = '62';
      await store1.commitDraftObservation({
        draft: personalDraft,
        committedAtUtc: '2026-11-13T07:19:10Z',
      });

      // Mutate SIM-01 by committing optional BP draft
      await store1.commitDraftObservation({
        draft: {
          ...SIM_01_OPTIONAL_BP_DRAFT,
          rawFields: {
            ...SIM_01_OPTIONAL_BP_DRAFT.rawFields,
            primary: '118',
            secondary: '76',
          },
        },
        committedAtUtc: '2026-11-13T07:19:20Z',
      });

      expect((await store1.loadProfileSnapshot(SIM_01_PROFILE_ID)).observations).toHaveLength(12);

      // Scoped demo reset restores SIM-01 to 11 rows without touching Personal profile
      await store1.resetDemoProfile(SIM_01_PROFILE_ID);
      expect((await store1.loadProfileSnapshot(SIM_01_PROFILE_ID)).observations).toHaveLength(11);
      expect((await store1.loadProfileSnapshot(personal.profileId)).observations).toHaveLength(1);

      // Replace-existing backup requires explicit confirmation
      const simSnap = await store1.loadProfileSnapshot(SIM_01_PROFILE_ID);
      const prefs = (await store1.loadAppSnapshot()).preferences;
      const backup = buildBackupBundle({
        confirmedIncludeAllProfileData: true,
        exportedAtUtc: SIM_01_SNAPSHOT_UTC,
        profile: simSnap.profile,
        preferences: prefs,
        observations: simSnap.observations,
        checkInEvents: simSnap.checkInEvents,
        references: simSnap.references,
        insights: simSnap.insights,
      });

      const unconfirmedReplace = await store1.restoreBackupBundle({
        rawBackup: backup,
        destination: 'replace_existing',
        targetExistingProfileId: personal.profileId,
        confirmedReplace: false,
      });
      expect(unconfirmedReplace.ok).toBe(false);
      expect(unconfirmedReplace.requiresConfirmation).toBe(true);
      expect(unconfirmedReplace.offerRecoveryCopy).toBe(true);

      // Default separate_profile restore adds a clean restored profile
      const sepRestore = await store1.restoreBackupBundle({
        rawBackup: EXAMPLE_BACKUP_BUNDLE,
        destination: 'separate_profile',
      });
      expect(sepRestore.ok).toBe(true);
      expect(sepRestore.restoredProfileId).not.toBe(SIM_01_PROFILE_ID);

      // Draft recovery bundle validation stays non-committing
      const draftBundle = buildDraftRecoveryBundle({
        draft: {
          ...SIM_01_OPTIONAL_BP_DRAFT,
          rawFields: {
            ...SIM_01_OPTIONAL_BP_DRAFT.rawFields,
            primary: '118',
            secondary: '76',
          },
        },
        profileLabel: simSnap.profile.label,
        exportedAtUtc: SIM_01_SNAPSHOT_UTC,
      });
      const draftRec = await store1.importDraftRecoveryBundle({
        rawBundle: draftBundle,
        activeProfileId: SIM_01_PROFILE_ID,
      });
      expect(draftRec.status).toBe('resume_draft');
      expect(
        await store1.importDraftRecoveryBundle({
          rawBundle: EXAMPLE_DRAFT_RECOVERY_BUNDLE,
          activeProfileId: SIM_01_PROFILE_ID,
        }),
      ).toHaveProperty('valid', true);

      // Delete only target Personal profile
      const fallbackActive = await store1.deletePersonalProfile(personal.profileId);
      expect(fallbackActive).toBeDefined();
    } finally {
      await driver1.close();
    }

    // Re-open database file to confirm durable SQLite persistence across sessions
    const driver2 = new NodeSqliteDriver(dbPath);
    const store2 = new CrewSignalSqliteStore(driver2);
    cleanups.push(async () => {
      await driver2.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    await store2.initialize();

    const reopened = await store2.loadAppSnapshot();
    expect(reopened.profiles.some((p) => p.label === 'Test Crewmember')).toBe(false);
    expect((await store2.loadProfileSnapshot(SIM_01_PROFILE_ID)).observations).toHaveLength(11);
  });
  test('Review P1: the first eligible fallback is persisted with its representative IDs and stays locked', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crewsignal-mobile-fallback-'));
    const dbPath = path.join(tmpDir, 'crewsignal.db');
    const driver1 = new NodeSqliteDriver(dbPath);
    const store1 = new CrewSignalSqliteStore(driver1);
    await store1.initialize();
    // SIM-01 without its entered-preflight sleep reference: 7 eligible Main sleep days.
    await driver1.run(
      "DELETE FROM personal_references WHERE profile_id = ? AND metric_id = 'sleep'",
      [SIM_01_PROFILE_ID],
    );
    await Promise.all([
      store1.lockEligibleFallbackReferences(SIM_01_PROFILE_ID),
      store1.lockEligibleFallbackReferences(SIM_01_PROFILE_ID),
    ]);
    const sleepRefs = async (st: CrewSignalSqliteStore) =>
      (await st.loadProfileSnapshot(SIM_01_PROFILE_ID)).references.filter(
        (r) => r.metricId === 'sleep',
      );
    const first = await sleepRefs(store1);
    expect(first).toHaveLength(1);
    const locked = first[0]!;
    expect(locked.provenance).toBe('seven_day_fallback_median');
    expect(locked.value).toEqual({ kind: 'sleep_duration', durationMinutes: 408 });
    expect(locked.selectedObservationIds).toHaveLength(7);

    // A later observation and an earlier import do not move the lock.
    const template = SIM_01_OBSERVATIONS.find((o) => o.metricId === 'sleep')!;
    const shifted = (id: string, day: number, minutes: number) => ({
      ...template,
      observationId: id,
      timing: { ...template.timing, endingMissionDay: day } as typeof template.timing,
      canonical: { ...template.canonical, durationMinutes: minutes } as typeof template.canonical,
    });
    const insertObs = (store1 as unknown as {
      insertObservationInTx(tx: unknown, o: unknown): Promise<void>;
    }).insertObservationInTx.bind(store1);
    for (const o of [
      shifted('obs-later-d43', 43, 300),
      shifted('obs-import-d30', 30, 520),
      shifted('obs-import-d31', 31, 515),
    ]) {
      await insertObs(driver1, o);
    }
    expect(await sleepRefs(store1)).toEqual([locked]);
    await driver1.close();

    // Restart: a fresh connection to the same file keeps the same lock.
    const driver2 = new NodeSqliteDriver(dbPath);
    cleanups.push(async () => {
      await driver2.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    const store2 = new CrewSignalSqliteStore(driver2);
    await store2.initialize();
    expect(await sleepRefs(store2)).toEqual([locked]);

    // An explicit update adds an active version 2 and keeps the superseded fallback.
    await store2.upsertPersonalReference({
      profileId: SIM_01_PROFILE_ID,
      metricId: 'sleep',
      provenance: 'user_updated',
      method: locked.method,
      context: locked.context,
      unit: 'min',
      value: { kind: 'sleep_duration', durationMinutes: 420 },
      nowUtc: SIM_01_SNAPSHOT_UTC,
    });
    const after = (await sleepRefs(store2)).sort((a, b) => a.version - b.version);
    expect(after.map((r) => [r.version, r.status])).toEqual([
      [1, 'superseded'],
      [2, 'active'],
    ]);
    expect(after[0]!.selectedObservationIds).toEqual(locked.selectedObservationIds);
  });
});
