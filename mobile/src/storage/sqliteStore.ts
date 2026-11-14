import {
  CREWSIGNAL_SCHEMA_VERSION,
  InsightSchema,
  ObservationSchema,
  ProfileConfigSchema,
  SIM_01_INSIGHTS,
  SIM_01_OBSERVATIONS,
  SIM_01_OPTIONAL_BP_DRAFT,
  SIM_01_PREFERENCES,
  SIM_01_PROFILE,
  SIM_01_PROFILE_ID,
  SIM_01_REFERENCES,
  SIM_SCHEDULE_OBSERVATIONS,
  SIM_SCHEDULE_PROFILE,
  buildCsvCommitPlan,
  computeMissionDay,
  createBlankDraft,
  createNewReferenceVersion,
  selectFallbackReferenceToLock,
  formatUtcTimeHHMM,
  markInsightReviewed as applyInsightReviewed,
  guidanceReviewIdentity,
  isInsightReviewCurrent,
  planCommitDraft,
  planProfileRestore,
  resolveUnknownCommitOutcome,
  validateBackupImport,
  validateDraftRecoveryImport,
  type AppPreferences,
  type BackupBundle,
  type CheckInDraft,
  type CheckInEvent,
  type CsvConflictChoice,
  type CsvPossibleDuplicateChoice,
  type CsvReconciliationPreview,
  type DraftRecoveryValidationResult,
  type Insight,
  type MetricId,
  type Observation,
  type PersonalReference,
  type ProfileConfig,
  type ReferenceValue,
  type ManualReferenceCapture,
  type UnknownOutcomeResolution,
} from '../shared/src';
import type { SqliteDriver, SqliteSession } from './driver';
import { CREWSIGNAL_DB_SCHEMA_VERSION, CREWSIGNAL_SCHEMA_SQL } from './schema';

export type CommitFailureSimulationMode =
  | 'none'
  | 'before_insert'
  | 'after_insert_rollback'
  | 'lost_ack';

export class LostCommitAcknowledgementError extends Error {
  readonly code = 'UNKNOWN_COMMIT_OUTCOME';

  constructor(message = 'Confirmation timed out while waiting for SQLite commit receipt.') {
    super(message);
    this.name = 'LostCommitAcknowledgementError';
  }
}

export interface ProfileSnapshot {
  profile: ProfileConfig;
  observations: Observation[];
  drafts: CheckInDraft[];
  checkInEvents: CheckInEvent[];
  references: PersonalReference[];
  insights: Insight[];
  importBatchCount: number;
}

export const TARGET_MISSING_MESSAGE =
  'The profile you chose to replace is no longer on this device. Nothing was changed. Choose a target again.';

/** What a full backup of one profile contains (a transactional, read-only view). */
export interface ProfileBackupData {
  profile: ProfileConfig;
  preferences: AppPreferences;
  observations: Observation[];
  checkInEvents: CheckInEvent[];
  references: PersonalReference[];
  insights: Insight[];
}

export interface AppSnapshot {
  preferences: AppPreferences;
  profiles: ProfileConfig[];
  active: ProfileSnapshot;
}

export interface CommitObservationResult {
  outcome: 'insert' | 'already_in_log' | 'validation_error';
  error: string | null;
  observation: Observation | null;
}

export interface ImportBatchCommitResult {
  ready: boolean;
  error: string | null;
  batchId: string | null;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
}

export interface RestoreBackupResult {
  ok: boolean;
  error: string | null;
  requiresConfirmation?: boolean;
  offerRecoveryCopy?: boolean;
  warningMessage?: string | null;
  /** The chosen replace target no longer exists; nothing was written. */
  targetMissing?: boolean;
  restoredProfileId?: string;
  restoredLabel?: string;
}

interface RawJsonRow extends Record<string, unknown> {
  raw_json: string;
}

interface CountRow extends Record<string, unknown> {
  count: number;
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

function remapProfileData(params: {
  targetProfileId: string;
  targetProfile: ProfileConfig;
  observations: readonly Observation[];
  events: readonly CheckInEvent[];
  references: readonly PersonalReference[];
  insights: readonly Insight[];
}): {
  profile: ProfileConfig;
  observations: Observation[];
  events: CheckInEvent[];
  references: PersonalReference[];
  insights: Insight[];
} {
  const { targetProfileId } = params;
  return {
    profile: { ...params.targetProfile, profileId: targetProfileId },
    observations: params.observations.map((obs) => ({
      ...obs,
      profileId: targetProfileId,
    })),
    events: params.events.map((ev) => ({
      ...ev,
      profileId: targetProfileId,
    })),
    references: params.references.map((ref) => ({
      ...ref,
      profileId: targetProfileId,
    })),
    insights: params.insights.map((ins) => ({
      ...ins,
      profileId: targetProfileId,
    })),
  };
}

/**
 * Single transactional SQLite repository shared by the native app (ExpoSqliteDriver)
 * and headless unit/integration tests (NodeSqliteDriver).
 */
export class CrewSignalSqliteStore {
  constructor(private readonly driver: SqliteDriver) {}

  async initialize(): Promise<void> {
    await this.driver.exec(CREWSIGNAL_SCHEMA_SQL);

    const existingSchema = await this.driver.getFirst<{ value: string }>(
      'SELECT value FROM schema_meta WHERE key = ?',
      ['schema_version'],
    );
    if (!existingSchema) {
      await this.driver.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', [
        'schema_version',
        String(CREWSIGNAL_DB_SCHEMA_VERSION),
      ]);
    }

    const existingPref = await this.driver.getFirst<RawJsonRow>(
      'SELECT raw_json FROM app_preferences WHERE id = 1',
    );
    const existingProfiles = await this.driver.getAll<RawJsonRow>(
      'SELECT raw_json FROM profiles',
    );

    if (!existingPref || existingProfiles.length === 0) {
      await this.driver.withTransaction(async (tx) => {
        await this.seedDemoProfileInTx(tx, {
          profile: SIM_01_PROFILE,
          observations: SIM_01_OBSERVATIONS,
          references: SIM_01_REFERENCES,
          insights: SIM_01_INSIGHTS,
          drafts: [SIM_01_OPTIONAL_BP_DRAFT],
        });

        await this.seedDemoProfileInTx(tx, {
          profile: SIM_SCHEDULE_PROFILE,
          observations: SIM_SCHEDULE_OBSERVATIONS,
          references: [],
          insights: [],
          drafts: [],
        });

        await this.writePreferencesInTx(tx, SIM_01_PREFERENCES);
      });
    }
  }

  private async seedDemoProfileInTx(
    tx: SqliteSession,
    seed: {
      profile: ProfileConfig;
      observations: readonly Observation[];
      references: readonly PersonalReference[];
      insights: readonly Insight[];
      drafts: readonly CheckInDraft[];
    },
  ): Promise<void> {
    const pid = seed.profile.profileId;
    await this.deleteProfileScopeInTx(tx, pid);

    await this.insertProfileInTx(tx, seed.profile);
    for (const obs of seed.observations) {
      await this.insertObservationInTx(tx, obs);
    }
    for (const ref of seed.references) {
      await this.insertReferenceInTx(tx, ref);
    }
    for (const ins of seed.insights) {
      await this.upsertInsightReviewInTx(tx, ins);
    }
    for (const draft of seed.drafts) {
      await this.upsertDraftInTx(tx, draft);
    }
  }

  private async deleteProfileScopeInTx(tx: SqliteSession, profileId: string): Promise<void> {
    await tx.run('DELETE FROM observations WHERE profile_id = ?', [profileId]);
    await tx.run('DELETE FROM check_in_drafts WHERE profile_id = ?', [profileId]);
    await tx.run('DELETE FROM check_in_events WHERE profile_id = ?', [profileId]);
    await tx.run('DELETE FROM personal_references WHERE profile_id = ?', [profileId]);
    await tx.run('DELETE FROM insight_reviews WHERE profile_id = ?', [profileId]);
    await tx.run('DELETE FROM import_batches WHERE profile_id = ?', [profileId]);
    await tx.run('DELETE FROM profiles WHERE profile_id = ?', [profileId]);
  }

  private async writePreferencesInTx(
    tx: SqliteSession,
    prefs: AppPreferences,
  ): Promise<void> {
    await tx.run(
      `INSERT INTO app_preferences (
        id, appearance, active_profile_id, display_unit_glucose, display_unit_temperature, help_mode, raw_json
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        appearance = excluded.appearance,
        active_profile_id = excluded.active_profile_id,
        display_unit_glucose = excluded.display_unit_glucose,
        display_unit_temperature = excluded.display_unit_temperature,
        help_mode = excluded.help_mode,
        raw_json = excluded.raw_json`,
      [
        prefs.appearance,
        prefs.activeProfileId,
        prefs.displayUnits.blood_glucose,
        prefs.displayUnits.body_temperature,
        prefs.helpMode,
        JSON.stringify(prefs),
      ],
    );
  }

  private async insertProfileInTx(tx: SqliteSession, profile: ProfileConfig): Promise<void> {
    await tx.run(
      `INSERT INTO profiles (
        profile_id, label, alias, mode, scenario_id, mission_name, mission_epoch_utc,
        display_timezone, snapshot_utc, created_at_utc, clock_version, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        label = excluded.label,
        alias = excluded.alias,
        mode = excluded.mode,
        scenario_id = excluded.scenario_id,
        mission_name = excluded.mission_name,
        mission_epoch_utc = excluded.mission_epoch_utc,
        display_timezone = excluded.display_timezone,
        snapshot_utc = excluded.snapshot_utc,
        created_at_utc = excluded.created_at_utc,
        clock_version = excluded.clock_version,
        raw_json = excluded.raw_json`,
      [
        profile.profileId,
        profile.label,
        profile.alias,
        profile.mode,
        profile.scenarioId,
        profile.missionName,
        profile.missionEpochUtc,
        profile.displayTimezone,
        profile.snapshotUtc,
        profile.createdAtUtc,
        profile.clockVersion,
        JSON.stringify(profile),
      ],
    );
  }

  private async insertObservationInTx(tx: SqliteSession, obs: Observation): Promise<void> {
    const validated = ObservationSchema.parse(obs);
    const observedMissionDay =
      validated.timing.kind === 'instant'
        ? validated.timing.missionDay
        : validated.timing.endingMissionDay;
    const observedAtUtc =
      validated.timing.kind === 'instant' ? validated.timing.observedAtUtc : null;
    const reportedAtUtc =
      validated.timing.kind === 'period' ? validated.timing.reportedAtUtc : null;

    await tx.run(
      `INSERT INTO observations (
        observation_id, profile_id, metric_id, timing_kind, observed_mission_day,
        observed_at_utc, reported_at_utc, recorded_at_utc, source_draft_id,
        import_batch_id, quality, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, observation_id) DO UPDATE SET
        metric_id = excluded.metric_id,
        timing_kind = excluded.timing_kind,
        observed_mission_day = excluded.observed_mission_day,
        observed_at_utc = excluded.observed_at_utc,
        reported_at_utc = excluded.reported_at_utc,
        recorded_at_utc = excluded.recorded_at_utc,
        source_draft_id = excluded.source_draft_id,
        import_batch_id = excluded.import_batch_id,
        quality = excluded.quality,
        raw_json = excluded.raw_json`,
      [
        validated.observationId,
        validated.profileId,
        validated.metricId,
        validated.timing.kind,
        observedMissionDay,
        observedAtUtc,
        reportedAtUtc,
        validated.recordedAtUtc,
        validated.sourceDraftId,
        validated.importBatchId,
        validated.quality,
        JSON.stringify(validated),
      ],
    );
  }

  private async upsertDraftInTx(tx: SqliteSession, draft: CheckInDraft): Promise<void> {
    await tx.run(
      `INSERT INTO check_in_drafts (
        draft_id, profile_id, metric_id, stage, status, commit_status,
        committed_observation_id, updated_at_utc, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, draft_id) DO UPDATE SET
        metric_id = excluded.metric_id,
        stage = excluded.stage,
        status = excluded.status,
        commit_status = excluded.commit_status,
        committed_observation_id = excluded.committed_observation_id,
        updated_at_utc = excluded.updated_at_utc,
        raw_json = excluded.raw_json`,
      [
        draft.draftId,
        draft.profileId,
        draft.metricId,
        draft.stage,
        draft.retentionStatus,
        draft.commitStatus,
        draft.committedObservationId,
        draft.updatedAtUtc,
        JSON.stringify(draft),
      ],
    );
  }

  private async insertCheckInEventInTx(
    tx: SqliteSession,
    event: CheckInEvent,
  ): Promise<void> {
    await tx.run(
      `INSERT INTO check_in_events (
        event_id, profile_id, event_type, metric_id, attempted_at_utc, recorded_at_utc, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, event_id) DO UPDATE SET
        event_type = excluded.event_type,
        metric_id = excluded.metric_id,
        attempted_at_utc = excluded.attempted_at_utc,
        recorded_at_utc = excluded.recorded_at_utc,
        raw_json = excluded.raw_json`,
      [
        event.eventId,
        event.profileId,
        event.eventType,
        event.metricId,
        event.attemptedAtUtc,
        event.recordedAtUtc,
        JSON.stringify(event),
      ],
    );
  }

  private async insertReferenceInTx(
    tx: SqliteSession,
    ref: PersonalReference,
  ): Promise<void> {
    await tx.run(
      `INSERT INTO personal_references (
        reference_id, profile_id, metric_id, version, status, created_at_utc, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, reference_id) DO UPDATE SET
        metric_id = excluded.metric_id,
        version = excluded.version,
        status = excluded.status,
        created_at_utc = excluded.created_at_utc,
        raw_json = excluded.raw_json`,
      [
        ref.referenceId,
        ref.profileId,
        ref.metricId,
        ref.version,
        ref.status,
        ref.createdAtUtc,
        JSON.stringify(ref),
      ],
    );
  }

  private async upsertInsightReviewInTx(tx: SqliteSession, insight: Insight): Promise<void> {
    const validated = InsightSchema.parse(insight);
    await tx.run(
      `INSERT INTO insight_reviews (
        review_key, profile_id, insight_id, observation_id, reviewed_at_utc, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, review_key) DO UPDATE SET
        insight_id = excluded.insight_id,
        observation_id = excluded.observation_id,
        reviewed_at_utc = excluded.reviewed_at_utc,
        raw_json = excluded.raw_json
      WHERE insight_reviews.reviewed_at_utc = ''`,
      [
        guidanceReviewIdentity(validated) ?? `${validated.insightId}:${validated.observationId}`,
        validated.profileId,
        validated.insightId,
        validated.observationId,
        validated.reviewedAtUtc ?? '',
        JSON.stringify(validated),
      ],
    );
  }

  async loadProfileObservations(
    profileId: string,
    session: SqliteSession = this.driver,
  ): Promise<Observation[]> {
    const rows = await session.getAll<RawJsonRow>(
      'SELECT raw_json FROM observations WHERE profile_id = ? ORDER BY observed_mission_day ASC, recorded_at_utc ASC',
      [profileId],
    );
    return rows.map((row) => parseJson<Observation>(row.raw_json));
  }

  /**
   * Persists the first eligible seven-day fallback reference (with its
   * representative observation IDs) for each metric that has no stored
   * reference. The check runs inside the write transaction, so later
   * observations, earlier imports and restarts reuse the saved lock and repeated
   * calls write at most one version 1. Returns the number of references written.
   */
  async lockEligibleFallbackReferences(profileId: string): Promise<number> {
    return this.driver.withTransaction<number>(async (tx) => {
      const profileRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM profiles WHERE profile_id = ?',
        [profileId],
      );
      if (!profileRow) return 0;
      const profile = parseJson<ProfileConfig>(profileRow.raw_json);
      const refRows = await tx.getAll<RawJsonRow>(
        'SELECT raw_json FROM personal_references WHERE profile_id = ?',
        [profileId],
      );
      const references = refRows.map((r) => parseJson<PersonalReference>(r.raw_json));
      const observations = await this.loadProfileObservations(profileId, tx);
      let written = 0;
      for (const metricId of [
        'heart_rate',
        'blood_pressure',
        'blood_glucose',
        'body_temperature',
        'sleep',
      ] as const) {
        const ref = selectFallbackReferenceToLock({
          profileId,
          metricId,
          references,
          observations,
          nowUtc: profile.snapshotUtc ?? new Date().toISOString(),
        });
        if (ref) {
          await this.insertReferenceInTx(tx, ref);
          written += 1;
        }
      }
      return written;
    });
  }

  async loadProfileSnapshot(
    profileId: string,
    options: { lockReferences?: boolean } = {},
  ): Promise<ProfileSnapshot> {
    // A read-only caller (a safety backup) skips the fallback-reference lock,
    // which can write.
    if (options.lockReferences !== false) {
      await this.lockEligibleFallbackReferences(profileId);
    }
    const profileRow = await this.driver.getFirst<RawJsonRow>(
      'SELECT raw_json FROM profiles WHERE profile_id = ?',
      [profileId],
    );
    if (!profileRow) {
      throw new Error(`Profile "${profileId}" does not exist in SQLite storage.`);
    }

    const [obsRows, draftRows, eventRows, refRows, insightRows, batchCountRow] =
      await Promise.all([
        this.driver.getAll<RawJsonRow>(
          'SELECT raw_json FROM observations WHERE profile_id = ? ORDER BY observed_mission_day ASC, recorded_at_utc ASC',
          [profileId],
        ),
        this.driver.getAll<RawJsonRow>(
          'SELECT raw_json FROM check_in_drafts WHERE profile_id = ? ORDER BY updated_at_utc DESC',
          [profileId],
        ),
        this.driver.getAll<RawJsonRow>(
          'SELECT raw_json FROM check_in_events WHERE profile_id = ? ORDER BY recorded_at_utc DESC',
          [profileId],
        ),
        this.driver.getAll<RawJsonRow>(
          'SELECT raw_json FROM personal_references WHERE profile_id = ? ORDER BY metric_id ASC, version DESC',
          [profileId],
        ),
        this.driver.getAll<RawJsonRow>(
          'SELECT raw_json FROM insight_reviews WHERE profile_id = ?',
          [profileId],
        ),
        this.driver.getFirst<CountRow>(
          'SELECT COUNT(*) as count FROM import_batches WHERE profile_id = ?',
          [profileId],
        ),
      ]);

    return {
      profile: parseJson<ProfileConfig>(profileRow.raw_json),
      observations: obsRows.map((r) => parseJson<Observation>(r.raw_json)),
      drafts: draftRows.map((r) => parseJson<CheckInDraft>(r.raw_json)),
      checkInEvents: eventRows.map((r) => parseJson<CheckInEvent>(r.raw_json)),
      references: refRows.map((r) => parseJson<PersonalReference>(r.raw_json)),
      insights: insightRows.map((r) => parseJson<Insight>(r.raw_json)),
      importBatchCount: Number(batchCountRow?.count ?? 0),
    };
  }

  /**
   * One consistent, read-only view of everything a full backup of this profile
   * holds, active or not: the profile, the app preferences, and its committed
   * observations, workflow events, references and insight reviews. All reads
   * share one short transaction, so a write that lands between two tables can
   * never produce a file that mixes old and new rows. Drafts are not part of a
   * backup. Throws if the profile does not exist.
   */
  async readProfileBackupData(profileId: string): Promise<ProfileBackupData> {
    return this.driver.withTransaction(async (tx) => {
      const profileRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM profiles WHERE profile_id = ?',
        [profileId],
      );
      if (!profileRow) {
        throw new Error(`Profile "${profileId}" does not exist in SQLite storage.`);
      }
      const prefRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM app_preferences WHERE id = 1',
      );
      const obsRows = await tx.getAll<RawJsonRow>(
        'SELECT raw_json FROM observations WHERE profile_id = ? ORDER BY observed_mission_day ASC, recorded_at_utc ASC',
        [profileId],
      );
      const eventRows = await tx.getAll<RawJsonRow>(
        'SELECT raw_json FROM check_in_events WHERE profile_id = ? ORDER BY recorded_at_utc DESC',
        [profileId],
      );
      const refRows = await tx.getAll<RawJsonRow>(
        'SELECT raw_json FROM personal_references WHERE profile_id = ? ORDER BY metric_id ASC, version DESC',
        [profileId],
      );
      const insightRows = await tx.getAll<RawJsonRow>(
        'SELECT raw_json FROM insight_reviews WHERE profile_id = ?',
        [profileId],
      );
      return {
        profile: parseJson<ProfileConfig>(profileRow.raw_json),
        preferences: prefRow
          ? parseJson<AppPreferences>(prefRow.raw_json)
          : { ...SIM_01_PREFERENCES, activeProfileId: profileId },
        observations: obsRows.map((r) => parseJson<Observation>(r.raw_json)),
        checkInEvents: eventRows.map((r) => parseJson<CheckInEvent>(r.raw_json)),
        references: refRows.map((r) => parseJson<PersonalReference>(r.raw_json)),
        insights: insightRows.map((r) => parseJson<Insight>(r.raw_json)),
      };
    });
  }

  async loadAppSnapshot(): Promise<AppSnapshot> {
    const prefRow = await this.driver.getFirst<RawJsonRow>(
      'SELECT raw_json FROM app_preferences WHERE id = 1',
    );
    const profileRows = await this.driver.getAll<RawJsonRow>(
      'SELECT raw_json FROM profiles ORDER BY CASE WHEN mode = \'demo\' THEN 0 ELSE 1 END, created_at_utc ASC',
    );
    const profiles = profileRows.map((r) => parseJson<ProfileConfig>(r.raw_json));
    if (profiles.length === 0) {
      throw new Error('No profiles available in SQLite storage.');
    }

    const preferences: AppPreferences = prefRow
      ? parseJson<AppPreferences>(prefRow.raw_json)
      : { ...SIM_01_PREFERENCES, activeProfileId: profiles[0]!.profileId };

    const activeExists = profiles.some(
      (p) => p.profileId === preferences.activeProfileId,
    );
    const resolvedActiveId = activeExists
      ? preferences.activeProfileId
      : profiles[0]!.profileId;

    const normalizedPrefs: AppPreferences = activeExists
      ? preferences
      : { ...preferences, activeProfileId: resolvedActiveId };

    const active = await this.loadProfileSnapshot(resolvedActiveId);
    return {
      preferences: normalizedPrefs,
      profiles,
      active,
    };
  }

  /** Stored drafts for one profile, active or not (read-only). */
  async loadProfileDrafts(profileId: string): Promise<CheckInDraft[]> {
    const rows = await this.driver.getAll<RawJsonRow>(
      'SELECT raw_json FROM check_in_drafts WHERE profile_id = ? ORDER BY updated_at_utc DESC',
      [profileId],
    );
    return rows.map((row) => parseJson<CheckInDraft>(row.raw_json));
  }

  /** True when an observation in this profile was committed from this draft. */
  async isDraftCommitted(profileId: string, draftId: string): Promise<boolean> {
    const row = await this.driver.getFirst<CountRow>(
      'SELECT COUNT(*) as count FROM observations WHERE profile_id = ? AND source_draft_id = ?',
      [profileId, draftId],
    );
    return (row?.count ?? 0) > 0;
  }

  async saveDraft(draft: CheckInDraft): Promise<void> {
    await this.driver.withTransaction(async (tx) => {
      await this.upsertDraftInTx(tx, draft);
    });
  }

  async discardDraft(profileId: string, draftId: string): Promise<void> {
    await this.driver.withTransaction(async (tx) => {
      await tx.run(
        'DELETE FROM check_in_drafts WHERE profile_id = ? AND draft_id = ?',
        [profileId, draftId],
      );
    });
  }

  async commitDraftObservation(params: {
    draft: CheckInDraft;
    committedAtUtc: string;
    observationId?: string;
    simulateFailureMode?: CommitFailureSimulationMode;
    confirmedUnusualValue?: boolean;
  }): Promise<CommitObservationResult> {
    const mode = params.simulateFailureMode ?? 'none';

    if (mode === 'before_insert') {
      throw new Error('Simulated SQLite write error before inserting observation.');
    }

    const result = await this.driver.withTransaction<CommitObservationResult>(async (tx) => {
      const existingObservations = await this.loadProfileObservations(
        params.draft.profileId,
        tx,
      );
      const plan = planCommitDraft({
        draft: params.draft,
        existingObservations,
        observationId: params.observationId ?? makeId(`obs-${params.draft.metricId}`),
        committedAtUtc: params.committedAtUtc,
        confirmedUnusualValue: params.confirmedUnusualValue,
      });

      if (!plan.ok || !plan.observation) {
        return {
          outcome: 'validation_error',
          error: plan.error ?? 'Entry validation failed.',
          observation: null,
        };
      }

      if (plan.outcome === 'already_in_log') {
        if (plan.draftToCloseId) {
          await tx.run(
            'DELETE FROM check_in_drafts WHERE profile_id = ? AND draft_id = ?',
            [params.draft.profileId, plan.draftToCloseId],
          );
        }
        return {
          outcome: 'already_in_log',
          error: null,
          observation: plan.existingObservation,
        };
      }

      // Single atomic SQLite transaction: insert observation AND close draft together.
      await this.insertObservationInTx(tx, plan.observation);

      if (mode === 'after_insert_rollback') {
        throw new Error('Simulated SQLite interruption before commit finalized.');
      }

      if (plan.draftToCloseId) {
        await tx.run(
          'DELETE FROM check_in_drafts WHERE profile_id = ? AND draft_id = ?',
          [params.draft.profileId, plan.draftToCloseId],
        );
      }

      return {
        outcome: 'insert',
        error: null,
        observation: plan.observation,
      };
    });

    if (mode === 'lost_ack') {
      throw new LostCommitAcknowledgementError();
    }

    return result;
  }

  async checkDraftCommitStatus(params: {
    profileId: string;
    draftId: string;
    simulateStorageReadFailure?: boolean;
  }): Promise<UnknownOutcomeResolution> {
    if (params.simulateStorageReadFailure) {
      return resolveUnknownCommitOutcome({
        draftId: params.draftId,
        profileId: params.profileId,
        storageCheckSucceeded: false,
        existingObservations: [],
      });
    }

    try {
      const existingObservations = await this.loadProfileObservations(params.profileId);
      const resolution = resolveUnknownCommitOutcome({
        draftId: params.draftId,
        profileId: params.profileId,
        storageCheckSucceeded: true,
        existingObservations,
      });

      if (resolution.status === 'already_in_log') {
        await this.driver.run(
          'DELETE FROM check_in_drafts WHERE profile_id = ? AND draft_id = ?',
          [params.profileId, params.draftId],
        );
      }
      return resolution;
    } catch {
      return resolveUnknownCommitOutcome({
        draftId: params.draftId,
        profileId: params.profileId,
        storageCheckSucceeded: false,
        existingObservations: [],
      });
    }
  }

  async recordWorkflowEvent(params: {
    event: CheckInEvent;
    discardDraftId?: string | null;
    keepDraft?: CheckInDraft | null;
  }): Promise<void> {
    await this.driver.withTransaction(async (tx) => {
      await this.insertCheckInEventInTx(tx, params.event);
      if (params.discardDraftId) {
        await tx.run(
          'DELETE FROM check_in_drafts WHERE profile_id = ? AND draft_id = ?',
          [params.event.profileId, params.discardDraftId],
        );
      } else if (params.keepDraft) {
        await this.upsertDraftInTx(tx, params.keepDraft);
      }
    });
  }

  async commitCsvImportBatch(params: {
    profileId: string;
    preview: CsvReconciliationPreview;
    conflictChoices: Record<string, CsvConflictChoice>;
    possibleDuplicateChoices: Record<string, CsvPossibleDuplicateChoice>;
    acknowledgedExclusions: boolean;
    confirmedUnusualValues?: boolean;
    nowUtc: string;
    batchId: string;
    simulateWriteFailure?: boolean;
  }): Promise<ImportBatchCommitResult> {
    return this.driver.withTransaction<ImportBatchCommitResult>(async (tx) => {
      const existingObservations = await this.loadProfileObservations(params.profileId, tx);
      const plan = buildCsvCommitPlan({
        preview: params.preview,
        existingObservations,
        conflictChoices: params.conflictChoices,
        possibleDuplicateChoices: params.possibleDuplicateChoices,
        acknowledgedExclusions: params.acknowledgedExclusions,
        confirmedUnusualValues: params.confirmedUnusualValues,
        nowUtc: params.nowUtc,
      });

      if (!plan.ready || !plan.nextObservations) {
        return {
          ready: false,
          error: plan.error ?? 'Import could not be committed.',
          batchId: null,
          insertedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
        };
      }

      for (const obs of plan.nextObservations) {
        await this.insertObservationInTx(tx, obs);
      }

      if (params.simulateWriteFailure) {
        throw new Error('Simulated CSV SQLite batch failure.');
      }

      await tx.run(
        `INSERT INTO import_batches (
          batch_id, profile_id, source_kind, committed_at_utc, row_count, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          params.batchId,
          params.profileId,
          'csv',
          params.nowUtc,
          plan.insertedCount + plan.updatedCount,
          JSON.stringify({
            batchId: params.batchId,
            insertedCount: plan.insertedCount,
            updatedCount: plan.updatedCount,
            skippedCount: plan.skippedCount,
            committedAtUtc: params.nowUtc,
          }),
        ],
      );

      return {
        ready: true,
        error: null,
        batchId: params.batchId,
        insertedCount: plan.insertedCount,
        updatedCount: plan.updatedCount,
        skippedCount: plan.skippedCount,
      };
    });
  }

  async updatePreferences(partial: Partial<AppPreferences>): Promise<AppPreferences> {
    return this.driver.withTransaction(async (tx) => {
      const prefRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM app_preferences WHERE id = 1',
      );
      const current = prefRow
        ? parseJson<AppPreferences>(prefRow.raw_json)
        : SIM_01_PREFERENCES;
      const next: AppPreferences = {
        ...current,
        ...partial,
        displayUnits: {
          ...current.displayUnits,
          ...(partial.displayUnits ?? {}),
        },
      };
      await this.writePreferencesInTx(tx, next);
      return next;
    });
  }

  async createPersonalProfile(params: {
    label: string;
    alias?: string | null;
    missionName?: string;
    missionEpochUtc: string;
    displayTimezone?: string;
    nowUtc: string;
  }): Promise<ProfileConfig> {
    const profile: ProfileConfig = ProfileConfigSchema.parse({
      profileId: makeId('personal'),
      label: params.label.trim() || 'Personal log',
      alias: params.alias?.trim() ? params.alias.trim() : null,
      mode: 'personal',
      scenarioId: null,
      missionName: params.missionName?.trim() || 'Personal mission',
      missionEpochUtc: params.missionEpochUtc,
      displayTimezone: params.displayTimezone?.trim() || 'UTC',
      snapshotUtc: null, // Strictly personal mode: real device clock
      createdAtUtc: params.nowUtc,
      clockVersion: 1,
      schedules: {
        heart_rate: null,
        blood_pressure: null,
        blood_glucose: null,
        body_temperature: null,
        sleep: null,
        mood: null,
      },
    });

    await this.driver.withTransaction(async (tx) => {
      await this.insertProfileInTx(tx, profile);
      const prefRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM app_preferences WHERE id = 1',
      );
      const current = prefRow
        ? parseJson<AppPreferences>(prefRow.raw_json)
        : SIM_01_PREFERENCES;
      await this.writePreferencesInTx(tx, {
        ...current,
        activeProfileId: profile.profileId,
      });
    });

    return profile;
  }

  async updateProfileConfig(profile: ProfileConfig): Promise<ProfileConfig> {
    const validated = ProfileConfigSchema.parse(profile);
    await this.driver.withTransaction(async (tx) => {
      await this.insertProfileInTx(tx, validated);
    });
    return validated;
  }

  async upsertPersonalReference(params: {
    profileId: string;
    metricId: Exclude<MetricId, 'mood'>;
    provenance: 'entered_preflight' | 'user_updated';
    method: string;
    context: string;
    unit: string;
    value: ReferenceValue;
    manualCapture?: ManualReferenceCapture;
    nowUtc: string;
  }): Promise<PersonalReference> {
    return this.driver.withTransaction(async (tx) => {
      const existingRows = await tx.getAll<RawJsonRow>(
        'SELECT raw_json FROM personal_references WHERE profile_id = ? AND metric_id = ?',
        [params.profileId, params.metricId],
      );
      const existingRefs = existingRows.map((r) => parseJson<PersonalReference>(r.raw_json));
      const updatedList = createNewReferenceVersion({
        existingReferences: existingRefs,
        profileId: params.profileId,
        metricId: params.metricId,
        provenance: params.provenance,
        method: params.method,
        context: params.context,
        unit: params.unit,
        value: params.value,
        manualCapture: params.manualCapture,
        createdAtUtc: params.nowUtc,
        referenceIdPrefix: makeId(`ref-${params.metricId}`),
      });

      for (const item of updatedList) {
        await this.insertReferenceInTx(tx, item);
      }
      return (
        updatedList.find((r) => r.status === 'active') ??
        updatedList[updatedList.length - 1]!
      );
    });
  }

  async markInsightReviewed(params: {
    insight: Insight;
    reviewedAtUtc: string;
  }): Promise<Insight> {
    const updated = applyInsightReviewed(params.insight, params.reviewedAtUtc);
    return this.driver.withTransaction(async (tx) => {
      const rows = await tx.getAll<RawJsonRow>('SELECT raw_json FROM insight_reviews WHERE profile_id = ?', [updated.profileId]);
      const existing = rows.map(row => parseJson<Insight>(row.raw_json)).find(row => isInsightReviewCurrent(row, updated));
      if (existing) return existing;
      await this.upsertInsightReviewInTx(tx, updated);
      const persisted = await tx.getFirst<RawJsonRow>('SELECT raw_json FROM insight_reviews WHERE profile_id = ? AND review_key = ?', [updated.profileId, guidanceReviewIdentity(updated)!]);
      return persisted ? parseJson<Insight>(persisted.raw_json) : updated;
    });
  }

  async restoreBackupBundle(params: {
    rawBackup: unknown;
    destination: 'separate_profile' | 'replace_existing';
    targetExistingProfileId?: string;
    confirmedReplace?: boolean;
    rejectPersonalInPublicDemo?: boolean;
    simulateWriteFailure?: boolean;
  }): Promise<RestoreBackupResult> {
    const validation = validateBackupImport(params.rawBackup, {
      rejectPersonalInPublicDemo: params.rejectPersonalInPublicDemo,
    });
    if (!validation.valid || !validation.bundle) {
      return {
        ok: false,
        error: validation.error ?? 'Backup validation failed.',
      };
    }

    const bundle: BackupBundle = validation.bundle;
    const profileRows = await this.driver.getAll<RawJsonRow>('SELECT raw_json FROM profiles');
    const existingProfiles = profileRows.map((r) => parseJson<ProfileConfig>(r.raw_json));

    const restorePlan = planProfileRestore({
      sourceProfile: bundle.profile,
      destination: params.destination,
      existingProfiles,
      targetExistingProfileId: params.targetExistingProfileId,
      newProfileId: makeId(`restored-${bundle.profile.mode}`),
    });

    if (restorePlan.targetMissing) {
      return { ok: false, error: restorePlan.warningMessage, targetMissing: true };
    }

    if (restorePlan.requiresConfirmation && !params.confirmedReplace) {
      return {
        ok: false,
        error: restorePlan.warningMessage,
        requiresConfirmation: true,
        offerRecoveryCopy: restorePlan.offerRecoveryCopy,
        warningMessage: restorePlan.warningMessage,
        restoredProfileId: restorePlan.targetProfileId,
        restoredLabel: restorePlan.targetLabel,
      };
    }

    const targetVanished = await this.driver.withTransaction(async (tx) => {
      if (params.destination === 'replace_existing') {
        // The plan was made before this transaction began. Check again inside it:
        // the target may have been deleted in between, and a replace must never
        // recreate it under the backup's profile ID.
        const stillThere = await tx.getFirst<RawJsonRow>(
          'SELECT raw_json FROM profiles WHERE profile_id = ?',
          [restorePlan.targetProfileId],
        );
        if (!stillThere) return true;
      }
      const remapped = remapProfileData({
        targetProfileId: restorePlan.targetProfileId,
        targetProfile: {
          ...bundle.profile,
          label: restorePlan.targetLabel,
        },
        observations: bundle.observations,
        events: bundle.checkInEvents,
        references: bundle.references,
        insights: bundle.insights,
      });

      if (params.destination === 'replace_existing') {
        await this.deleteProfileScopeInTx(tx, restorePlan.targetProfileId);
      }

      await this.insertProfileInTx(tx, remapped.profile);
      for (const obs of remapped.observations) {
        await this.insertObservationInTx(tx, obs);
      }
      for (const ev of remapped.events) {
        await this.insertCheckInEventInTx(tx, ev);
      }
      for (const ref of remapped.references) {
        await this.insertReferenceInTx(tx, ref);
      }
      for (const ins of remapped.insights) {
        await this.upsertInsightReviewInTx(tx, ins);
      }

      if (params.simulateWriteFailure) {
        throw new Error('Simulated backup restore SQLite failure.');
      }

      const prefRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM app_preferences WHERE id = 1',
      );
      const currentPrefs = prefRow
        ? parseJson<AppPreferences>(prefRow.raw_json)
        : SIM_01_PREFERENCES;

      await this.writePreferencesInTx(tx, {
        ...currentPrefs,
        appearance: bundle.preferences.appearance,
        displayUnits: bundle.preferences.displayUnits,
        activeProfileId: remapped.profile.profileId,
      });
      return false;
    });

    if (targetVanished) {
      return {
        ok: false,
        error: TARGET_MISSING_MESSAGE,
        targetMissing: true,
      };
    }

    return {
      ok: true,
      error: null,
      restoredProfileId: restorePlan.targetProfileId,
      restoredLabel: restorePlan.targetLabel,
    };
  }

  async importDraftRecoveryBundle(params: {
    rawBundle: unknown;
    activeProfileId: string;
    rejectPersonalInPublicDemo?: boolean;
  }): Promise<DraftRecoveryValidationResult> {
    const existingObservations = await this.loadProfileObservations(params.activeProfileId);
    const result = validateDraftRecoveryImport(params.rawBundle, {
      existingObservations,
      rejectPersonalInPublicDemo: params.rejectPersonalInPublicDemo,
    });

    if (result.valid && result.status === 'resume_draft' && result.bundle) {
      const recoveredDraft: CheckInDraft = {
        ...result.bundle.draft,
        profileId: params.activeProfileId,
        retentionStatus: 'retained',
        commitStatus: 'uncommitted',
      };
      await this.saveDraft(recoveredDraft);
    }

    return result;
  }

  async resetDemoProfile(profileId: string = SIM_01_PROFILE_ID): Promise<void> {
    await this.driver.withTransaction(async (tx) => {
      if (profileId === SIM_SCHEDULE_PROFILE.profileId) {
        await this.seedDemoProfileInTx(tx, {
          profile: SIM_SCHEDULE_PROFILE,
          observations: SIM_SCHEDULE_OBSERVATIONS,
          references: [],
          insights: [],
          drafts: [],
        });
      } else {
        await this.seedDemoProfileInTx(tx, {
          profile: SIM_01_PROFILE,
          observations: SIM_01_OBSERVATIONS,
          references: SIM_01_REFERENCES,
          insights: SIM_01_INSIGHTS,
          drafts: [SIM_01_OPTIONAL_BP_DRAFT],
        });
      }
    });
  }

  async deletePersonalProfile(profileId: string): Promise<string> {
    return this.driver.withTransaction(async (tx) => {
      const targetRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM profiles WHERE profile_id = ?',
        [profileId],
      );
      if (!targetRow) {
        throw new Error(`Profile "${profileId}" does not exist.`);
      }
      const parsedTarget = parseJson<ProfileConfig>(targetRow.raw_json);
      if (parsedTarget.mode === 'demo') {
        throw new Error('Demo scenarios use scoped demo reset instead of personal deletion.');
      }

      await this.deleteProfileScopeInTx(tx, profileId);

      const remainingRows = await tx.getAll<RawJsonRow>(
        'SELECT raw_json FROM profiles ORDER BY created_at_utc ASC',
      );
      let nextActiveId = remainingRows
        .map((r) => parseJson<ProfileConfig>(r.raw_json))
        .find((p) => p.profileId !== profileId)?.profileId;

      if (!nextActiveId) {
        await this.seedDemoProfileInTx(tx, {
          profile: SIM_01_PROFILE,
          observations: SIM_01_OBSERVATIONS,
          references: SIM_01_REFERENCES,
          insights: SIM_01_INSIGHTS,
          drafts: [SIM_01_OPTIONAL_BP_DRAFT],
        });
        nextActiveId = SIM_01_PROFILE_ID;
      }

      const prefRow = await tx.getFirst<RawJsonRow>(
        'SELECT raw_json FROM app_preferences WHERE id = 1',
      );
      const prefs = prefRow
        ? parseJson<AppPreferences>(prefRow.raw_json)
        : SIM_01_PREFERENCES;
      await this.writePreferencesInTx(tx, {
        ...prefs,
        activeProfileId: nextActiveId,
      });

      return nextActiveId;
    });
  }

  /**
   * Builds a clean blank draft for the given metric using current profile timing
   * and display preferences without writing anything until user edits or requests save.
   */
  buildDraftForProfile(params: {
    profile: ProfileConfig;
    metricId: MetricId;
    preferences: AppPreferences;
    nowUtc: string;
  }): CheckInDraft {
    const preferredUnit =
      params.metricId === 'blood_glucose'
        ? params.preferences.displayUnits.blood_glucose
        : params.metricId === 'body_temperature'
          ? params.preferences.displayUnits.body_temperature
          : undefined;

    return createBlankDraft({
      draftId: makeId(`draft-${params.metricId}`),
      profileId: params.profile.profileId,
      mode: params.profile.mode,
      metricId: params.metricId,
      missionEpochUtc: params.profile.missionEpochUtc,
      proposedMissionDay: computeMissionDay(
        params.nowUtc,
        params.profile.missionEpochUtc,
      ),
      proposedTimeHHMM: formatUtcTimeHHMM(params.nowUtc),
      nowUtc: params.nowUtc,
      preferredUnit,
    });
  }

  getSchemaVersion(): number {
    return CREWSIGNAL_SCHEMA_VERSION;
  }
}
