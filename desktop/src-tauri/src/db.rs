use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

use crate::models::{
    AppSnapshot, CommandError, CommitCheckInEventOutcome, CommitCheckInEventRequest,
    CommitCsvBatchOutcome, CommitCsvBatchRequest, CommitObservationOutcome,
    CommitObservationRequest, DeleteProfileOutcome, DiagnosticHooks, LookupCommitOutcome,
    ProfileBundleData, ProfileRecord, ProfileSeedInput, RestoreBackupOutcome,
    RestoreBackupRequest, SaveDraftOutcome,
};

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK(mode IN ('demo', 'personal')),
    alias TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    epoch_utc TEXT NOT NULL,
    timezone TEXT NOT NULL,
    clock_version INTEGER NOT NULL DEFAULT 1,
    snapshot_utc TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    settings_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_clock_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    clock_version INTEGER NOT NULL,
    epoch_utc TEXT NOT NULL,
    timezone TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    origin_draft_id TEXT,
    metric TEXT NOT NULL,
    timing_kind TEXT NOT NULL,
    observed_at TEXT,
    period_ending_day INTEGER,
    import_batch_id TEXT,
    source_row_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id)
);

CREATE INDEX IF NOT EXISTS idx_observations_profile_draft
    ON observations(profile_id, origin_draft_id);

CREATE TABLE IF NOT EXISTS observation_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    observation_id TEXT NOT NULL,
    previous_payload_json TEXT NOT NULL,
    new_payload_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    corrected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    metric TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id)
);

CREATE TABLE IF NOT EXISTS checkin_events (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('unavailable', 'skipped')),
    metric TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id)
);

CREATE TABLE IF NOT EXISTS personal_references (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    metric TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id, version)
);

CREATE TABLE IF NOT EXISTS action_reviews (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id)
);

CREATE TABLE IF NOT EXISTS import_batches (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, batch_id)
);

CREATE TABLE IF NOT EXISTS schedules (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, metric)
);
"#;

pub struct Database {
    db_path: Option<PathBuf>,
    journal_mode: String,
    conn: Mutex<Connection>,
    hooks: Mutex<DiagnosticHooks>,
}

impl Database {
    pub fn open_file(path: &Path) -> Result<Self, CommandError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                CommandError::with_detail(
                    "DB_DIR_CREATE_FAILED",
                    "Could not prepare local storage directory.",
                    e.to_string(),
                )
            })?;
        }
        let conn = Connection::open(path).map_err(|e| {
            CommandError::with_detail(
                "DB_OPEN_FAILED",
                "Could not open local SQLite database.",
                e.to_string(),
            )
        })?;
        let journal_mode = Self::configure_connection(&conn)?;
        Ok(Self {
            db_path: Some(path.to_path_buf()),
            journal_mode,
            conn: Mutex::new(conn),
            hooks: Mutex::new(DiagnosticHooks::default()),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, CommandError> {
        let conn = Connection::open_in_memory().map_err(|e| {
            CommandError::with_detail(
                "DB_OPEN_FAILED",
                "Could not initialize in-memory SQLite database.",
                e.to_string(),
            )
        })?;
        let journal_mode = Self::configure_connection(&conn)?;
        Ok(Self {
            db_path: None,
            journal_mode,
            conn: Mutex::new(conn),
            hooks: Mutex::new(DiagnosticHooks::default()),
        })
    }

    fn configure_connection(conn: &Connection) -> Result<String, CommandError> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = FULL;",
        )
        .map_err(|e| {
            CommandError::with_detail(
                "DB_PRAGMA_FAILED",
                "Could not configure SQLite durability pragmas.",
                e.to_string(),
            )
        })?;

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode = WAL;", [], |row| row.get(0))
            .unwrap_or_else(|_| "memory".to_string());

        conn.execute_batch(SCHEMA_SQL).map_err(|e| {
            CommandError::with_detail(
                "DB_SCHEMA_FAILED",
                "Could not initialize CrewSignal local SQLite tables.",
                e.to_string(),
            )
        })?;

        Ok(journal_mode)
    }

    pub fn db_path_display(&self) -> String {
        self.db_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ":memory:".to_string())
    }

    pub fn journal_mode(&self) -> &str {
        &self.journal_mode
    }

    pub fn get_hooks(&self) -> DiagnosticHooks {
        self.hooks
            .lock()
            .map(|h| h.clone())
            .unwrap_or_default()
    }

    pub fn set_hooks(&self, hooks: DiagnosticHooks) {
        if let Ok(mut guard) = self.hooks.lock() {
            *guard = hooks;
        }
    }

    fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, CommandError> {
        self.conn.lock().map_err(|_| {
            CommandError::new(
                "DB_LOCK_POISONED",
                "Local storage connection became unavailable.",
            )
        })
    }

    pub fn ensure_demo_seed_if_missing(
        &self,
        seed: ProfileSeedInput,
    ) -> Result<bool, CommandError> {
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let exists: Option<String> = tx
            .query_row(
                "SELECT id FROM profiles WHERE id = ?1",
                params![seed.profile.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;

        if exists.is_some() {
            tx.commit().map_err(map_sqlite_err)?;
            return Ok(false);
        }

        insert_profile_seed_tx(&tx, &seed)?;

        let has_active: Option<String> = tx
            .query_row(
                "SELECT value FROM meta WHERE key = 'active_profile_id'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;
        if has_active.is_none() {
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('active_profile_id', ?1)",
                params![seed.profile.id],
            )
            .map_err(map_sqlite_err)?;
        }

        let has_prefs: Option<String> = tx
            .query_row(
                "SELECT value FROM meta WHERE key = 'app_preferences'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;
        if has_prefs.is_none() {
            let default_prefs = normalize_preferences(None, &seed.profile.id);
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('app_preferences', ?1)",
                params![default_prefs.to_string()],
            )
            .map_err(map_sqlite_err)?;
        }

        tx.commit().map_err(map_sqlite_err)?;
        Ok(true)
    }

    pub fn reset_demo_profile(&self, seed: ProfileSeedInput) -> Result<AppSnapshot, CommandError> {
        if seed.profile.mode != "demo" {
            return Err(CommandError::new(
                "INVALID_DEMO_RESET_SCOPE",
                "Demo reset can only target a demo profile.",
            ));
        }

        {
            let mut conn = self.lock_conn()?;
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sqlite_err)?;

            delete_profile_children_tx(&tx, &seed.profile.id)?;
            tx.execute(
                "DELETE FROM profiles WHERE id = ?1",
                params![seed.profile.id],
            )
            .map_err(map_sqlite_err)?;

            insert_profile_seed_tx(&tx, &seed)?;

            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('active_profile_id', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![seed.profile.id],
            )
            .map_err(map_sqlite_err)?;

            tx.commit().map_err(map_sqlite_err)?;
        }

        self.load_app_snapshot(Some(&seed.profile.id))
    }

    pub fn create_personal_profile(
        &self,
        profile: ProfileRecord,
    ) -> Result<ProfileRecord, CommandError> {
        if profile.mode != "personal" {
            return Err(CommandError::new(
                "INVALID_PROFILE_MODE",
                "New user-created profiles must use personal mode.",
            ));
        }

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        insert_profile_row_tx(&tx, &profile)?;

        let clock_payload = json!({
            "clockVersion": profile.clock_version,
            "epochUtc": profile.epoch_utc,
            "timezone": profile.timezone,
            "changedAt": profile.created_at,
        });
        tx.execute(
            "INSERT INTO profile_clock_history (profile_id, clock_version, epoch_utc, timezone, changed_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                profile.id,
                profile.clock_version,
                profile.epoch_utc,
                profile.timezone,
                profile.created_at,
                clock_payload.to_string(),
            ],
        )
        .map_err(map_sqlite_err)?;

        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('active_profile_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![profile.id],
        )
        .map_err(map_sqlite_err)?;

        tx.commit().map_err(map_sqlite_err)?;
        Ok(profile)
    }

    pub fn set_active_profile(&self, profile_id: &str) -> Result<AppSnapshot, CommandError> {
        {
            let mut conn = self.lock_conn()?;
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sqlite_err)?;

            let exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM profiles WHERE id = ?1",
                    params![profile_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(map_sqlite_err)?;
            if exists.is_none() {
                return Err(CommandError::new(
                    "PROFILE_NOT_FOUND",
                    "Selected profile does not exist in local storage.",
                ));
            }

            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('active_profile_id', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![profile_id],
            )
            .map_err(map_sqlite_err)?;

            tx.commit().map_err(map_sqlite_err)?;
        }

        self.load_app_snapshot(Some(profile_id))
    }

    pub fn delete_personal_profile(
        &self,
        profile_id: &str,
    ) -> Result<DeleteProfileOutcome, CommandError> {
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let mode: Option<String> = tx
            .query_row(
                "SELECT mode FROM profiles WHERE id = ?1",
                params![profile_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;

        match mode.as_deref() {
            None => {
                return Err(CommandError::new(
                    "PROFILE_NOT_FOUND",
                    "The selected personal profile was not found.",
                ));
            }
            Some("demo") => {
                return Err(CommandError::new(
                    "CANNOT_DELETE_DEMO_PROFILE",
                    "The SIM-01 demo profile uses Reset demo instead of deletion.",
                ));
            }
            Some(_) => {}
        }

        delete_profile_children_tx(&tx, profile_id)?;
        tx.execute("DELETE FROM profiles WHERE id = ?1", params![profile_id])
            .map_err(map_sqlite_err)?;

        let fallback_profile_id: String = tx
            .query_row(
                "SELECT id FROM profiles ORDER BY CASE WHEN mode = 'demo' THEN 0 ELSE 1 END, created_at ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .map_err(map_sqlite_err)?;

        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('active_profile_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![fallback_profile_id],
        )
        .map_err(map_sqlite_err)?;

        tx.commit().map_err(map_sqlite_err)?;

        Ok(DeleteProfileOutcome {
            deleted_profile_id: profile_id.to_string(),
            fallback_profile_id,
        })
    }

    pub fn update_preferences(&self, preferences: Value) -> Result<Value, CommandError> {
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let active_fallback: Option<String> = tx
            .query_row(
                "SELECT value FROM meta WHERE key = 'active_profile_id'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;
        let active_id = preferences
            .get("activeProfileId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or(active_fallback)
            .unwrap_or_default();
        let preferences = normalize_preferences(Some(&preferences), &active_id);

        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('app_preferences', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![preferences.to_string()],
        )
        .map_err(map_sqlite_err)?;

        tx.commit().map_err(map_sqlite_err)?;
        Ok(preferences)
    }

    pub fn update_profile_clock(
        &self,
        profile_id: &str,
        epoch_utc: &str,
        timezone: &str,
        snapshot_utc: Option<&str>,
        changed_at: &str,
    ) -> Result<ProfileRecord, CommandError> {
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let current_version: i64 = tx
            .query_row(
                "SELECT clock_version FROM profiles WHERE id = ?1",
                params![profile_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?
            .ok_or_else(|| CommandError::new("PROFILE_NOT_FOUND", "Profile not found."))?;

        let next_version = current_version + 1;

        tx.execute(
            "UPDATE profiles
             SET epoch_utc = ?2, timezone = ?3, clock_version = ?4, snapshot_utc = ?5, updated_at = ?6
             WHERE id = ?1",
            params![
                profile_id,
                epoch_utc,
                timezone,
                next_version,
                snapshot_utc,
                changed_at
            ],
        )
        .map_err(map_sqlite_err)?;

        let clock_payload = json!({
            "clockVersion": next_version,
            "epochUtc": epoch_utc,
            "timezone": timezone,
            "snapshotUtc": snapshot_utc,
            "changedAt": changed_at,
        });

        tx.execute(
            "INSERT INTO profile_clock_history (profile_id, clock_version, epoch_utc, timezone, changed_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                profile_id,
                next_version,
                epoch_utc,
                timezone,
                changed_at,
                clock_payload.to_string(),
            ],
        )
        .map_err(map_sqlite_err)?;

        let updated = query_profile_tx(&tx, profile_id)?;
        tx.commit().map_err(map_sqlite_err)?;
        Ok(updated)
    }

    pub fn update_profile_settings(
        &self,
        profile_id: &str,
        alias: &str,
        settings: Value,
        updated_at: &str,
    ) -> Result<ProfileRecord, CommandError> {
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let affected = tx
            .execute(
                "UPDATE profiles SET alias = ?2, settings_json = ?3, updated_at = ?4 WHERE id = ?1",
                params![profile_id, alias, settings.to_string(), updated_at],
            )
            .map_err(map_sqlite_err)?;

        if affected == 0 {
            return Err(CommandError::new("PROFILE_NOT_FOUND", "Profile not found."));
        }

        let updated = query_profile_tx(&tx, profile_id)?;
        tx.commit().map_err(map_sqlite_err)?;
        Ok(updated)
    }

    pub fn upsert_personal_reference(
        &self,
        profile_id: &str,
        reference: Value,
    ) -> Result<Value, CommandError> {
        let ref_id = str_any(&reference, &["referenceId", "id"])?;
        let metric = str_any(&reference, &["metricId", "metric"])?;
        let version = reference
            .get("version")
            .and_then(|v| v.as_i64())
            .unwrap_or(1);
        let created_at = reference
            .get("createdAtUtc").or_else(|| reference.get("createdAt"))
            .and_then(|v| v.as_str())
            .unwrap_or("2026-11-13T07:18:00Z");

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        // An explicit new active version supersedes the previous active version of
        // the same metric inside the same transaction, so the history keeps both.
        let is_active = reference.get("status").and_then(|v| v.as_str()) == Some("active");
        if is_active {
            let mut stmt = tx
                .prepare(
                    "SELECT id, version, payload_json FROM personal_references
                     WHERE profile_id = ?1 AND metric = ?2 AND NOT (id = ?3 AND version = ?4)",
                )
                .map_err(map_sqlite_err)?;
            let rows = stmt
                .query_map(params![profile_id, metric, ref_id, version], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
                })
                .map_err(map_sqlite_err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_sqlite_err)?;
            drop(stmt);
            for (old_id, old_version, raw) in rows {
                let mut old: Value = serde_json::from_str(&raw).map_err(map_json_err)?;
                if old.get("status").and_then(|v| v.as_str()) != Some("active") {
                    continue;
                }
                old["status"] = json!("superseded");
                tx.execute(
                    "UPDATE personal_references SET payload_json = ?4
                     WHERE profile_id = ?1 AND id = ?2 AND version = ?3",
                    params![profile_id, old_id, old_version, old.to_string()],
                )
                .map_err(map_sqlite_err)?;
            }
        }

        tx.execute(
            "INSERT INTO personal_references (profile_id, id, metric, version, created_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(profile_id, id, version) DO UPDATE SET payload_json = excluded.payload_json",
            params![
                profile_id,
                ref_id,
                metric,
                version,
                created_at,
                reference.to_string(),
            ],
        )
        .map_err(map_sqlite_err)?;

        tx.commit().map_err(map_sqlite_err)?;
        Ok(reference)
    }

    /// Stores an automatically locked seven-day fallback reference only when the
    /// profile has no reference for that metric yet. The check runs inside the
    /// write transaction, so a stale snapshot can never supersede a newer explicit
    /// version and repeated calls write at most one row. Returns whether it wrote.
    pub fn lock_fallback_reference(
        &self,
        profile_id: &str,
        reference: Value,
    ) -> Result<bool, CommandError> {
        let ref_id = str_any(&reference, &["referenceId", "id"])?;
        let metric = str_any(&reference, &["metricId", "metric"])?;
        let version = reference.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
        let created_at = reference
            .get("createdAtUtc")
            .and_then(|v| v.as_str())
            .unwrap_or("2026-11-13T07:18:00Z");
        if reference.get("provenance").and_then(|v| v.as_str()) != Some("seven_day_fallback_median")
            || reference.get("status").and_then(|v| v.as_str()) != Some("active")
        {
            return Err(CommandError::new(
                "INVALID_FALLBACK_REFERENCE",
                "Only an active seven-day fallback reference can be locked automatically.",
            ));
        }

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;
        let existing: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM personal_references WHERE profile_id = ?1 AND metric = ?2",
                params![profile_id, metric],
                |r| r.get(0),
            )
            .map_err(map_sqlite_err)?;
        if existing > 0 {
            tx.commit().map_err(map_sqlite_err)?;
            return Ok(false);
        }
        tx.execute(
            "INSERT INTO personal_references (profile_id, id, metric, version, created_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![profile_id, ref_id, metric, version, created_at, reference.to_string()],
        )
        .map_err(map_sqlite_err)?;
        tx.commit().map_err(map_sqlite_err)?;
        Ok(true)
    }

    pub fn upsert_schedule(
        &self,
        profile_id: &str,
        schedule: Value,
    ) -> Result<Value, CommandError> {
        let metric = str_any(&schedule, &["metricId", "metric"])?;
        let updated_at = schedule
            .pointer("/schedule/configuredAtUtc").or_else(|| schedule.get("updatedAt"))
            .and_then(|v| v.as_str())
            .unwrap_or("2026-11-13T07:18:00Z");

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        tx.execute(
            "INSERT INTO schedules (profile_id, metric, updated_at, payload_json)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(profile_id, metric) DO UPDATE SET updated_at = excluded.updated_at, payload_json = excluded.payload_json",
            params![profile_id, metric, updated_at, schedule.to_string()],
        )
        .map_err(map_sqlite_err)?;

        tx.commit().map_err(map_sqlite_err)?;
        Ok(schedule)
    }

    pub fn record_action_review(
        &self,
        profile_id: &str,
        review: Value,
    ) -> Result<Value, CommandError> {
        if review.get("profileId").and_then(Value::as_str).is_some_and(|id| id != profile_id) {
            return Err(CommandError::new("PROFILE_MISMATCH", "Review belongs to another profile."));
        }
        let id = str_any(&review, &["reviewId", "id"])?;
        let action_id = str_field(&review, "actionId")?;
        let reviewed_at = str_any(&review, &["reviewedAtUtc", "reviewedAt"])?;

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        tx.execute(
            "INSERT INTO action_reviews (profile_id, id, action_id, reviewed_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(profile_id, id) DO NOTHING",
            params![profile_id, id, action_id, reviewed_at, review.to_string()],
        )
        .map_err(map_sqlite_err)?;

        let payload: String = tx.query_row(
            "SELECT payload_json FROM action_reviews WHERE profile_id = ?1 AND id = ?2",
            params![profile_id, id], |row| row.get(0),
        ).map_err(map_sqlite_err)?;
        let saved = serde_json::from_str(&payload).map_err(map_json_err)?;
        tx.commit().map_err(map_sqlite_err)?;
        Ok(saved)
    }

    pub fn save_draft(&self, profile_id: &str, draft: Value) -> Result<SaveDraftOutcome, CommandError> {
        let hooks = self.get_hooks();
        if hooks.simulate_draft_retention_failure {
            // ER-04: the draft stays on screen only. Report it like the shared contract
            // expects (retained: false, memory_only) instead of failing the command.
            let mut memory_only = draft;
            memory_only["retentionStatus"] = json!("memory_only");
            return Ok(SaveDraftOutcome {
                retained: false,
                draft: memory_only,
            });
        }

        let mut draft = draft;
        if draft.is_object() {
            draft["retentionStatus"] = json!("retained");
        }
        let draft_id = str_any(&draft, &["draftId", "id"])?;
        let metric = str_any(&draft, &["metricId", "metric"])?;
        let updated_at = draft
            .get("updatedAtUtc").or_else(|| draft.get("updatedAt"))
            .and_then(|v| v.as_str())
            .unwrap_or("2026-11-13T07:18:00Z");

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let profile_exists: Option<String> = tx
            .query_row(
                "SELECT id FROM profiles WHERE id = ?1",
                params![profile_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;
        if profile_exists.is_none() {
            return Err(CommandError::new("PROFILE_NOT_FOUND", "Profile not found."));
        }

        tx.execute(
            "INSERT INTO drafts (profile_id, id, metric, updated_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(profile_id, id) DO UPDATE SET
                 metric = excluded.metric,
                 updated_at = excluded.updated_at,
                 payload_json = excluded.payload_json",
            params![profile_id, draft_id, metric, updated_at, draft.to_string()],
        )
        .map_err(map_sqlite_err)?;

        tx.commit().map_err(map_sqlite_err)?;

        Ok(SaveDraftOutcome {
            retained: true,
            draft,
        })
    }

    pub fn delete_draft(&self, profile_id: &str, draft_id: &str) -> Result<bool, CommandError> {
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let deleted = tx
            .execute(
                "DELETE FROM drafts WHERE profile_id = ?1 AND id = ?2",
                params![profile_id, draft_id],
            )
            .map_err(map_sqlite_err)?;

        tx.commit().map_err(map_sqlite_err)?;
        Ok(deleted > 0)
    }

    /// Single-connection atomic transaction (`BEGIN IMMEDIATE` ... `COMMIT`/`ROLLBACK`)
    /// combining idempotence lookup, observation insertion, and closure of ONLY `draft_id`.
    pub fn commit_observation(
        &self,
        req: CommitObservationRequest,
    ) -> Result<CommitObservationOutcome, CommandError> {
        let hooks = self.get_hooks();
        let obs_id = str_any(&req.observation, &["observationId", "id"])?;
        let metric = str_any(&req.observation, &["metricId", "metric"])?;

        // The draft, the observation payload and the destination profile must
        // all name the same scope. Anything else would add one profile's
        // entry to another profile's log.
        let payload_profile = req.observation.get("profileId").and_then(|v| v.as_str());
        if payload_profile.is_some_and(|p| p != req.profile_id) {
            return Err(CommandError::new(
                "COMMIT_SCOPE_MISMATCH",
                format!(
                    "This entry belongs to another profile (entry={} target={}). No changes made.",
                    payload_profile.unwrap_or_default(),
                    req.profile_id
                ),
            ));
        }
        let payload_draft = req.observation.get("sourceDraftId").and_then(|v| v.as_str());
        if payload_draft.is_some_and(|d| d != req.draft_id) {
            return Err(CommandError::new(
                "COMMIT_SCOPE_MISMATCH",
                "This entry was prepared from a different draft. No changes made.",
            ));
        }

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let draft_owner: Option<String> = tx
            .query_row(
                "SELECT profile_id FROM drafts WHERE id = ?1 AND profile_id <> ?2 LIMIT 1",
                params![req.draft_id, req.profile_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;
        if let Some(owner) = draft_owner {
            return Err(CommandError::new(
                "COMMIT_SCOPE_MISMATCH",
                format!(
                    "This draft is kept under another profile (draft={} target={}). No changes made.",
                    owner, req.profile_id
                ),
            ));
        }

        let existing_json: Option<String> = tx
            .query_row(
                "SELECT payload_json FROM observations
                 WHERE profile_id = ?1 AND (id = ?2 OR origin_draft_id = ?3)
                 LIMIT 1",
                params![req.profile_id, obs_id, req.draft_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;

        if let Some(existing_str) = existing_json {
            let deleted = tx
                .execute(
                    "DELETE FROM drafts WHERE profile_id = ?1 AND id = ?2",
                    params![req.profile_id, req.draft_id],
                )
                .map_err(map_sqlite_err)?;
            let count = count_observations_tx(&tx, &req.profile_id)?;
            tx.commit().map_err(map_sqlite_err)?;
            let existing: Value = serde_json::from_str(&existing_str).map_err(map_json_err)?;
            return Ok(CommitObservationOutcome {
                outcome: "already_in_log".to_string(),
                observation: existing,
                draft_closed: deleted > 0,
                profile_observation_count: count,
            });
        }

        let profile_exists: Option<String> = tx
            .query_row(
                "SELECT id FROM profiles WHERE id = ?1",
                params![req.profile_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;
        if profile_exists.is_none() {
            return Err(CommandError::new(
                "PROFILE_NOT_FOUND",
                "Active profile not found in SQLite.",
            ));
        }

        insert_observation_tx(
            &tx,
            &req.profile_id,
            Some(&req.draft_id),
            None,
            &req.observation,
            &obs_id,
            &metric,
        )?;

        let closed_rows = tx
            .execute(
                "DELETE FROM drafts WHERE profile_id = ?1 AND id = ?2",
                params![req.profile_id, req.draft_id],
            )
            .map_err(map_sqlite_err)?;

        if hooks.simulate_commit_rollback {
            // Dropping `tx` without committing triggers SQLite ROLLBACK!
            return Err(CommandError::new(
                "COMMIT_ROLLED_BACK",
                "Could not add to your log. The transaction was rolled back and your draft remains intact.",
            ));
        }

        let count = count_observations_tx(&tx, &req.profile_id)?;
        tx.commit().map_err(map_sqlite_err)?;

        if hooks.simulate_lost_ack {
            return Err(CommandError::new(
                "UNKNOWN_OUTCOME",
                "Addition unconfirmed. Check the log for this entry before adding again.",
            ));
        }

        Ok(CommitObservationOutcome {
            outcome: "committed".to_string(),
            observation: req.observation,
            draft_closed: closed_rows > 0,
            profile_observation_count: count,
        })
    }

    pub fn check_observation_status(
        &self,
        profile_id: &str,
        observation_id: Option<&str>,
        draft_id: Option<&str>,
    ) -> Result<LookupCommitOutcome, CommandError> {
        let hooks = self.get_hooks();
        if hooks.simulate_lookup_unavailable {
            return Ok(LookupCommitOutcome {
                state: "unconfirmed".to_string(),
                observation: None,
            });
        }

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let existing_json: Option<String> = match (observation_id, draft_id) {
            (None, None) => {
                return Err(CommandError::new(
                    "LOOKUP_KEY_REQUIRED",
                    "An observation ID or draft ID is required to check the log.",
                ))
            }
            (obs, d) => tx
                .query_row(
                    "SELECT payload_json FROM observations
                     WHERE profile_id = ?1
                       AND ((?2 IS NOT NULL AND id = ?2) OR (?3 IS NOT NULL AND origin_draft_id = ?3))
                     LIMIT 1",
                    params![profile_id, obs, d],
                    |r| r.get(0),
                )
                .optional()
                .map_err(map_sqlite_err)?,
        };

        if let (Some(_), Some(d_id)) = (&existing_json, draft_id) {
            tx.execute(
                "DELETE FROM drafts WHERE profile_id = ?1 AND id = ?2",
                params![profile_id, d_id],
            )
            .map_err(map_sqlite_err)?;
        }

        tx.commit().map_err(map_sqlite_err)?;

        match existing_json {
            Some(raw) => {
                let obs: Value = serde_json::from_str(&raw).map_err(map_json_err)?;
                Ok(LookupCommitOutcome {
                    state: "already_in_log".to_string(),
                    observation: Some(obs),
                })
            }
            None => Ok(LookupCommitOutcome {
                state: "not_found".to_string(),
                observation: None,
            }),
        }
    }

    pub fn commit_checkin_event(
        &self,
        req: CommitCheckInEventRequest,
    ) -> Result<CommitCheckInEventOutcome, CommandError> {
        let hooks = self.get_hooks();
        let event_id = str_any(&req.event, &["eventId", "id"])?;
        let kind = event_kind(&req.event)?;
        let metric = req
            .event
            .get("metricId").or_else(|| req.event.get("metric"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let created_at = req
            .event
            .get("recordedAtUtc").or_else(|| req.event.get("attemptedAtUtc")).or_else(|| req.event.get("createdAt"))
            .and_then(|v| v.as_str())
            .unwrap_or("2026-11-13T07:18:00Z");

        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let existing: Option<String> = tx
            .query_row(
                "SELECT payload_json FROM checkin_events WHERE profile_id = ?1 AND id = ?2",
                params![req.profile_id, event_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;

        if let Some(raw) = existing {
            tx.commit().map_err(map_sqlite_err)?;
            let ev: Value = serde_json::from_str(&raw).map_err(map_json_err)?;
            return Ok(CommitCheckInEventOutcome {
                outcome: "already_recorded".to_string(),
                event: ev,
                discarded_draft_id: None,
            });
        }

        tx.execute(
            "INSERT INTO checkin_events (profile_id, id, kind, metric, created_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                req.profile_id,
                event_id,
                kind,
                metric,
                created_at,
                req.event.to_string(),
            ],
        )
        .map_err(map_sqlite_err)?;

        let mut discarded = None;
        if let Some(ref discard_id) = req.discard_draft_id {
            let rows = tx
                .execute(
                    "DELETE FROM drafts WHERE profile_id = ?1 AND id = ?2",
                    params![req.profile_id, discard_id],
                )
                .map_err(map_sqlite_err)?;
            if rows > 0 {
                discarded = Some(discard_id.clone());
            }
        }

        if hooks.simulate_commit_rollback {
            return Err(CommandError::new(
                "EVENT_COMMIT_ROLLED_BACK",
                "Could not record check-in event. No changes were saved.",
            ));
        }

        tx.commit().map_err(map_sqlite_err)?;

        Ok(CommitCheckInEventOutcome {
            outcome: "recorded".to_string(),
            event: req.event,
            discarded_draft_id: discarded,
        })
    }

    pub fn commit_csv_import_batch(
        &self,
        req: CommitCsvBatchRequest,
    ) -> Result<CommitCsvBatchOutcome, CommandError> {
        let hooks = self.get_hooks();
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let existing_batch: Option<String> = tx
            .query_row(
                "SELECT batch_id FROM import_batches WHERE profile_id = ?1 AND batch_id = ?2",
                params![req.profile_id, req.batch_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;

        if existing_batch.is_some() {
            tx.commit().map_err(map_sqlite_err)?;
            return Ok(CommitCsvBatchOutcome {
                outcome: "already_applied".to_string(),
                inserted_count: 0,
                replaced_count: 0,
            });
        }

        let mut inserted_count = 0usize;
        for obs in &req.new_observations {
            let obs_id = str_any(obs, &["observationId", "id"])?;
            let metric = str_any(obs, &["metricId", "metric"])?;
            insert_observation_tx(
                &tx,
                &req.profile_id,
                None,
                Some(&req.batch_id),
                obs,
                &obs_id,
                &metric,
            )?;
            inserted_count += 1;
        }

        let mut replaced_count = 0usize;
        for repl in &req.conflict_replacements {
            let new_metric = str_any(&repl.new_payload, &["metricId", "metric"])?;
            let updated_at = repl
                .new_payload
                .get("recordedAtUtc").or_else(|| repl.new_payload.get("updatedAt"))
                .and_then(|v| v.as_str())
                .unwrap_or(&repl.corrected_at);
            let rows = tx
                .execute(
                    "UPDATE observations
                     SET metric = ?3, updated_at = ?4, import_batch_id = ?5, payload_json = ?6
                     WHERE profile_id = ?1 AND id = ?2",
                    params![
                        req.profile_id,
                        repl.observation_id,
                        new_metric,
                        updated_at,
                        req.batch_id,
                        repl.new_payload.to_string(),
                    ],
                )
                .map_err(map_sqlite_err)?;
            if rows == 0 {
                return Err(CommandError::new(
                    "CONFLICT_TARGET_MISSING",
                    "Target observation for conflict replacement no longer exists. Import rolled back.",
                ));
            }
            tx.execute(
                "INSERT INTO observation_corrections (profile_id, observation_id, previous_payload_json, new_payload_json, reason, corrected_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    req.profile_id,
                    repl.observation_id,
                    repl.previous_payload.to_string(),
                    repl.new_payload.to_string(),
                    repl.reason,
                    repl.corrected_at,
                ],
            )
            .map_err(map_sqlite_err)?;
            replaced_count += 1;
        }

        let created_at = req
            .summary
            .get("createdAt")
            .and_then(|v| v.as_str())
            .unwrap_or("2026-11-13T07:18:00Z");

        tx.execute(
            "INSERT INTO import_batches (profile_id, batch_id, kind, created_at, summary_json)
             VALUES (?1, ?2, 'csv', ?3, ?4)",
            params![
                req.profile_id,
                req.batch_id,
                created_at,
                req.summary.to_string()
            ],
        )
        .map_err(map_sqlite_err)?;

        if hooks.simulate_commit_rollback {
            return Err(CommandError::new(
                "CSV_IMPORT_ROLLED_BACK",
                "CSV import failed and was rolled back. No changes made.",
            ));
        }

        tx.commit().map_err(map_sqlite_err)?;
        Ok(CommitCsvBatchOutcome {
            outcome: "committed".to_string(),
            inserted_count,
            replaced_count,
        })
    }

    pub fn restore_backup(
        &self,
        req: RestoreBackupRequest,
    ) -> Result<RestoreBackupOutcome, CommandError> {
        let hooks = self.get_hooks();
        let mut conn = self.lock_conn()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_err)?;

        let mut target_profile = req.profile.clone();
        let replaced_existing = match req.target_mode.as_str() {
            "separate_profile" => {
                // Guarantee the restored copy gets a distinct profile ID and never touches existing profiles.
                let exists: Option<String> = tx
                    .query_row(
                        "SELECT id FROM profiles WHERE id = ?1",
                        params![target_profile.id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(map_sqlite_err)?;
                if exists.is_some() {
                    return Err(CommandError::new(
                        "RESTORE_PROFILE_ID_COLLISION",
                        "Separate restore destination ID already exists. No changes made.",
                    ));
                }
                insert_profile_row_tx(&tx, &target_profile)?;
                false
            }
            "replace_profile" => {
                let target_id = req.target_profile_id.as_deref().ok_or_else(|| {
                    CommandError::new(
                        "RESTORE_TARGET_REQUIRED",
                        "Replacement restore requires an explicit target profile. No changes made.",
                    )
                })?;
                let existing_mode: Option<String> = tx
                    .query_row(
                        "SELECT mode FROM profiles WHERE id = ?1",
                        params![target_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(map_sqlite_err)?;
                if existing_mode.is_none() {
                    return Err(CommandError::new(
                        "RESTORE_TARGET_NOT_FOUND",
                        "Replacement target profile was not found. No changes made.",
                    ));
                }
                if existing_mode.as_deref() != Some(target_profile.mode.as_str()) {
                    // Demo data must never overwrite a Personal log (or vice versa).
                    return Err(CommandError::with_detail(
                        "RESTORE_MODE_MISMATCH",
                        "This backup is from a different mode than the profile it would replace. No changes made.",
                        format!(
                            "backup={} target={}",
                            target_profile.mode,
                            existing_mode.unwrap_or_default()
                        ),
                    ));
                }
                target_profile.id = target_id.to_string();
                delete_profile_children_tx(&tx, target_id)?;
                tx.execute(
                    "UPDATE profiles
                     SET mode = ?2, alias = ?3, mission_id = ?4, epoch_utc = ?5, timezone = ?6,
                         clock_version = ?7, snapshot_utc = ?8, updated_at = ?9, settings_json = ?10
                     WHERE id = ?1",
                    params![
                        target_profile.id,
                        target_profile.mode,
                        target_profile.alias,
                        target_profile.mission_id,
                        target_profile.epoch_utc,
                        target_profile.timezone,
                        target_profile.clock_version,
                        target_profile.snapshot_utc,
                        target_profile.updated_at,
                        target_profile.settings.to_string(),
                    ],
                )
                .map_err(map_sqlite_err)?;
                true
            }
            other => {
                return Err(CommandError::with_detail(
                    "INVALID_RESTORE_MODE",
                    "Unsupported restore target mode. No changes made.",
                    other,
                ));
            }
        };

        for obs in &req.observations {
            let obs_id = str_any(obs, &["observationId", "id"])?;
            let metric = str_any(obs, &["metricId", "metric"])?;
            insert_observation_tx(&tx, &target_profile.id, None, None, obs, &obs_id, &metric)?;
        }

        for corr in &req.corrections {
            let obs_id = str_field(corr, "observationId")?;
            let reason = corr
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Backup restore");
            let corrected_at = corr
                .get("correctedAt")
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.updated_at);
            let prev = corr.get("previousPayload").or_else(|| corr.get("previous")).cloned().unwrap_or(Value::Null);
            let next = corr.get("newPayload").or_else(|| corr.get("next")).cloned().unwrap_or(Value::Null);
            tx.execute(
                "INSERT INTO observation_corrections (profile_id, observation_id, previous_payload_json, new_payload_json, reason, corrected_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    target_profile.id,
                    obs_id,
                    prev.to_string(),
                    next.to_string(),
                    reason,
                    corrected_at
                ],
            )
            .map_err(map_sqlite_err)?;
        }

        for ev in &req.checkin_events {
            let id = str_any(ev, &["eventId", "id"])?;
            let kind = event_kind(ev)?;
            let metric = ev.get("metricId").or_else(|| ev.get("metric")).and_then(|v| v.as_str());
            let created_at = ev
                .get("recordedAtUtc").or_else(|| ev.get("attemptedAtUtc")).or_else(|| ev.get("createdAt"))
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.created_at);
            tx.execute(
                "INSERT INTO checkin_events (profile_id, id, kind, metric, created_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![target_profile.id, id, kind, metric, created_at, ev.to_string()],
            )
            .map_err(map_sqlite_err)?;
        }

        for reference in &req.references {
            let id = str_any(reference, &["referenceId", "id"])?;
            let metric = str_any(reference, &["metricId", "metric"])?;
            let version = reference.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
            let created_at = reference
                .get("createdAtUtc").or_else(|| reference.get("createdAt"))
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.created_at);
            tx.execute(
                "INSERT INTO personal_references (profile_id, id, metric, version, created_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    target_profile.id,
                    id,
                    metric,
                    version,
                    created_at,
                    reference.to_string()
                ],
            )
            .map_err(map_sqlite_err)?;
        }

        for review in &req.action_reviews {
            let id = str_any(review, &["reviewId", "id"])?;
            let action_id = str_field(review, "actionId")?;
            let reviewed_at = review
                .get("reviewedAtUtc").or_else(|| review.get("reviewedAt"))
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.updated_at);
            tx.execute(
                "INSERT INTO action_reviews (profile_id, id, action_id, reviewed_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    target_profile.id,
                    id,
                    action_id,
                    reviewed_at,
                    review.to_string()
                ],
            )
            .map_err(map_sqlite_err)?;
        }

        for sched in &req.schedules {
            let metric = str_any(sched, &["metricId", "metric"])?;
            let updated_at = sched
                .pointer("/schedule/configuredAtUtc").or_else(|| sched.get("updatedAt"))
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.updated_at);
            tx.execute(
                "INSERT INTO schedules (profile_id, metric, updated_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4)",
                params![target_profile.id, metric, updated_at, sched.to_string()],
            )
            .map_err(map_sqlite_err)?;
        }

        for clk in &req.clock_history {
            let clock_version = clk
                .get("clockVersion")
                .and_then(|v| v.as_i64())
                .unwrap_or(target_profile.clock_version);
            let epoch_utc = clk
                .get("epochUtc")
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.epoch_utc);
            let timezone = clk
                .get("timezone")
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.timezone);
            let changed_at = clk
                .get("changedAt")
                .and_then(|v| v.as_str())
                .unwrap_or(&target_profile.created_at);
            tx.execute(
                "INSERT INTO profile_clock_history (profile_id, clock_version, epoch_utc, timezone, changed_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    target_profile.id,
                    clock_version,
                    epoch_utc,
                    timezone,
                    changed_at,
                    clk.to_string()
                ],
            )
            .map_err(map_sqlite_err)?;
        }

        if hooks.simulate_commit_rollback {
            return Err(CommandError::new(
                "RESTORE_ROLLED_BACK",
                "Restore failed: no changes made.",
            ));
        }

        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('active_profile_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![target_profile.id],
        )
        .map_err(map_sqlite_err)?;

        let observation_count = req.observations.len();
        tx.commit().map_err(map_sqlite_err)?;

        Ok(RestoreBackupOutcome {
            restored_profile: target_profile,
            observation_count,
            replaced_existing,
        })
    }

    pub fn load_app_snapshot(&self, profile_override: Option<&str>) -> Result<AppSnapshot, CommandError> {
        let hooks = self.get_hooks();
        if hooks.simulate_log_read_failure {
            return Err(CommandError::new(
                "LOG_UNAVAILABLE",
                "Stored records could not be checked.",
            ));
        }

        let conn = self.lock_conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, mode, alias, mission_id, epoch_utc, timezone, clock_version, snapshot_utc, created_at, updated_at, settings_json
                 FROM profiles
                 ORDER BY CASE WHEN mode = 'demo' THEN 0 ELSE 1 END, created_at ASC",
            )
            .map_err(map_sqlite_err)?;

        let profiles = stmt
            .query_map([], |row| {
                let settings_str: String = row.get(10)?;
                let settings: Value =
                    serde_json::from_str(&settings_str).unwrap_or_else(|_| json!({}));
                Ok(ProfileRecord {
                    id: row.get(0)?,
                    mode: row.get(1)?,
                    alias: row.get(2)?,
                    mission_id: row.get(3)?,
                    epoch_utc: row.get(4)?,
                    timezone: row.get(5)?,
                    clock_version: row.get(6)?,
                    snapshot_utc: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    settings,
                })
            })
            .map_err(map_sqlite_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_err)?;

        if profiles.is_empty() {
            return Err(CommandError::new(
                "NO_PROFILES_INITIALIZED",
                "No local CrewSignal profiles are initialized yet.",
            ));
        }

        let meta_active: Option<String> = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'active_profile_id'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;

        let chosen_id = profile_override
            .and_then(|id| profiles.iter().find(|p| p.id == id).map(|p| p.id.clone()))
            .or_else(|| {
                meta_active.and_then(|id| profiles.iter().find(|p| p.id == id).map(|p| p.id.clone()))
            })
            .unwrap_or_else(|| profiles[0].id.clone());

        let prefs_raw: Option<String> = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'app_preferences'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_err)?;

        // Saved preferences may predate the shared shape (legacy keys from early
        // builds). Always hand the UI the canonical AppPreferences shape.
        let preferences: Value = normalize_preferences(
            prefs_raw.and_then(|s| serde_json::from_str(&s).ok()).as_ref(),
            &chosen_id,
        );

        let profile_data = load_profile_bundle_conn(&conn, &chosen_id)?;

        Ok(AppSnapshot {
            active_profile_id: chosen_id,
            profiles,
            preferences,
            profile_data,
        })
    }

    pub fn load_profile_bundle(&self, profile_id: &str) -> Result<ProfileBundleData, CommandError> {
        let hooks = self.get_hooks();
        if hooks.simulate_log_read_failure {
            return Err(CommandError::new(
                "LOG_UNAVAILABLE",
                "Stored records could not be checked.",
            ));
        }
        let conn = self.lock_conn()?;
        load_profile_bundle_conn(&conn, profile_id)
    }
}

fn load_profile_bundle_conn(
    conn: &Connection,
    profile_id: &str,
) -> Result<ProfileBundleData, CommandError> {
    let observations = query_json_rows(
        conn,
        "SELECT payload_json FROM observations WHERE profile_id = ?1 ORDER BY created_at ASC, id ASC",
        profile_id,
    )?;
    let corrections = query_corrections(conn, profile_id)?;
    let drafts = query_json_rows(
        conn,
        "SELECT payload_json FROM drafts WHERE profile_id = ?1 ORDER BY updated_at DESC, id ASC",
        profile_id,
    )?;
    let checkin_events = query_json_rows(
        conn,
        "SELECT payload_json FROM checkin_events WHERE profile_id = ?1 ORDER BY created_at ASC, id ASC",
        profile_id,
    )?;
    let references = query_json_rows(
        conn,
        "SELECT payload_json FROM personal_references WHERE profile_id = ?1 ORDER BY created_at ASC, version ASC",
        profile_id,
    )?;
    let action_reviews = query_json_rows(
        conn,
        "SELECT payload_json FROM action_reviews WHERE profile_id = ?1 ORDER BY reviewed_at ASC, id ASC",
        profile_id,
    )?;
    let schedules = query_json_rows(
        conn,
        "SELECT payload_json FROM schedules WHERE profile_id = ?1 ORDER BY metric ASC",
        profile_id,
    )?;
    let clock_history = query_json_rows(
        conn,
        "SELECT payload_json FROM profile_clock_history WHERE profile_id = ?1 ORDER BY clock_version ASC",
        profile_id,
    )?;
    let import_batches = query_json_rows(
        conn,
        "SELECT summary_json FROM import_batches WHERE profile_id = ?1 ORDER BY created_at ASC",
        profile_id,
    )?;

    Ok(ProfileBundleData {
        profile_id: profile_id.to_string(),
        observations,
        corrections,
        drafts,
        checkin_events,
        references,
        action_reviews,
        schedules,
        clock_history,
        import_batches,
    })
}

fn query_json_rows(
    conn: &Connection,
    sql: &str,
    profile_id: &str,
) -> Result<Vec<Value>, CommandError> {
    let mut stmt = conn.prepare(sql).map_err(map_sqlite_err)?;
    let rows = stmt
        .query_map(params![profile_id], |row| row.get::<_, String>(0))
        .map_err(map_sqlite_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_err)?;

    let mut out = Vec::with_capacity(rows.len());
    for raw in rows {
        let val: Value = serde_json::from_str(&raw).map_err(map_json_err)?;
        out.push(val);
    }
    Ok(out)
}

fn query_corrections(conn: &Connection, profile_id: &str) -> Result<Vec<Value>, CommandError> {
    let mut stmt = conn
        .prepare(
            "SELECT observation_id, previous_payload_json, new_payload_json, reason, corrected_at
             FROM observation_corrections WHERE profile_id = ?1 ORDER BY id ASC",
        )
        .map_err(map_sqlite_err)?;

    let rows = stmt
        .query_map(params![profile_id], |row| {
            let obs_id: String = row.get(0)?;
            let prev_raw: String = row.get(1)?;
            let next_raw: String = row.get(2)?;
            let reason: String = row.get(3)?;
            let corrected_at: String = row.get(4)?;
            let prev: Value = serde_json::from_str(&prev_raw).unwrap_or(Value::Null);
            let next: Value = serde_json::from_str(&next_raw).unwrap_or(Value::Null);
            Ok(json!({
                "observationId": obs_id,
                "previousPayload": prev.clone(),
                "newPayload": next.clone(),
                "previous": prev,
                "next": next,
                "reason": reason,
                "correctedAt": corrected_at,
            }))
        })
        .map_err(map_sqlite_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_err)?;

    Ok(rows)
}

fn query_profile_tx(
    tx: &rusqlite::Transaction<'_>,
    profile_id: &str,
) -> Result<ProfileRecord, CommandError> {
    tx.query_row(
        "SELECT id, mode, alias, mission_id, epoch_utc, timezone, clock_version, snapshot_utc, created_at, updated_at, settings_json
         FROM profiles WHERE id = ?1",
        params![profile_id],
        |row| {
            let settings_str: String = row.get(10)?;
            let settings: Value = serde_json::from_str(&settings_str).unwrap_or_else(|_| json!({}));
            Ok(ProfileRecord {
                id: row.get(0)?,
                mode: row.get(1)?,
                alias: row.get(2)?,
                mission_id: row.get(3)?,
                epoch_utc: row.get(4)?,
                timezone: row.get(5)?,
                clock_version: row.get(6)?,
                snapshot_utc: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                settings,
            })
        },
    )
    .map_err(map_sqlite_err)
}

fn insert_profile_row_tx(
    tx: &rusqlite::Transaction<'_>,
    p: &ProfileRecord,
) -> Result<(), CommandError> {
    tx.execute(
        "INSERT INTO profiles (id, mode, alias, mission_id, epoch_utc, timezone, clock_version, snapshot_utc, created_at, updated_at, settings_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            p.id,
            p.mode,
            p.alias,
            p.mission_id,
            p.epoch_utc,
            p.timezone,
            p.clock_version,
            p.snapshot_utc,
            p.created_at,
            p.updated_at,
            p.settings.to_string(),
        ],
    )
    .map_err(map_sqlite_err)?;
    Ok(())
}

fn insert_profile_seed_tx(
    tx: &rusqlite::Transaction<'_>,
    seed: &ProfileSeedInput,
) -> Result<(), CommandError> {
    insert_profile_row_tx(tx, &seed.profile)?;

    let clock_payload = if seed.clock_history.is_empty() {
        vec![json!({
            "clockVersion": seed.profile.clock_version,
            "epochUtc": seed.profile.epoch_utc,
            "timezone": seed.profile.timezone,
            "snapshotUtc": seed.profile.snapshot_utc,
            "changedAt": seed.profile.created_at,
        })]
    } else {
        seed.clock_history.clone()
    };

    for clk in &clock_payload {
        let clock_version = clk
            .get("clockVersion")
            .and_then(|v| v.as_i64())
            .unwrap_or(seed.profile.clock_version);
        let epoch_utc = clk
            .get("epochUtc")
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.epoch_utc);
        let timezone = clk
            .get("timezone")
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.timezone);
        let changed_at = clk
            .get("changedAt")
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.created_at);
        tx.execute(
            "INSERT INTO profile_clock_history (profile_id, clock_version, epoch_utc, timezone, changed_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                seed.profile.id,
                clock_version,
                epoch_utc,
                timezone,
                changed_at,
                clk.to_string(),
            ],
        )
        .map_err(map_sqlite_err)?;
    }

    for obs in &seed.observations {
        let obs_id = str_any(obs, &["observationId", "id"])?;
        let metric = str_any(obs, &["metricId", "metric"])?;
        insert_observation_tx(tx, &seed.profile.id, None, None, obs, &obs_id, &metric)?;
    }

    for r in &seed.references {
        let id = str_any(r, &["referenceId", "id"])?;
        let metric = str_any(r, &["metricId", "metric"])?;
        let version = r.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
        let created_at = r
            .get("createdAtUtc").or_else(|| r.get("createdAt"))
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.created_at);
        tx.execute(
            "INSERT INTO personal_references (profile_id, id, metric, version, created_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                seed.profile.id,
                id,
                metric,
                version,
                created_at,
                r.to_string()
            ],
        )
        .map_err(map_sqlite_err)?;
    }

    for sched in &seed.schedules {
        let metric = str_any(sched, &["metricId", "metric"])?;
        let updated_at = sched
            .pointer("/schedule/configuredAtUtc").or_else(|| sched.get("updatedAt"))
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.updated_at);
        tx.execute(
            "INSERT INTO schedules (profile_id, metric, updated_at, payload_json)
             VALUES (?1, ?2, ?3, ?4)",
            params![seed.profile.id, metric, updated_at, sched.to_string()],
        )
        .map_err(map_sqlite_err)?;
    }

    for ev in &seed.checkin_events {
        let id = str_any(ev, &["eventId", "id"])?;
        let kind = event_kind(ev)?;
        let metric = ev.get("metricId").or_else(|| ev.get("metric")).and_then(|v| v.as_str());
        let created_at = ev
            .get("recordedAtUtc").or_else(|| ev.get("attemptedAtUtc")).or_else(|| ev.get("createdAt"))
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.created_at);
        tx.execute(
            "INSERT INTO checkin_events (profile_id, id, kind, metric, created_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                seed.profile.id,
                id,
                kind,
                metric,
                created_at,
                ev.to_string()
            ],
        )
        .map_err(map_sqlite_err)?;
    }

    for draft in &seed.drafts {
        let id = str_any(draft, &["draftId", "id"])?;
        let metric = str_any(draft, &["metricId", "metric"])?;
        let updated_at = draft
            .get("updatedAtUtc").or_else(|| draft.get("updatedAt"))
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.updated_at);
        tx.execute(
            "INSERT INTO drafts (profile_id, id, metric, updated_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![seed.profile.id, id, metric, updated_at, draft.to_string()],
        )
        .map_err(map_sqlite_err)?;
    }

    for review in &seed.action_reviews {
        let id = str_any(review, &["reviewId", "id"])?;
        let action_id = str_field(review, "actionId")?;
        let reviewed_at = review
            .get("reviewedAtUtc").or_else(|| review.get("reviewedAt"))
            .and_then(|v| v.as_str())
            .unwrap_or(&seed.profile.updated_at);
        tx.execute(
            "INSERT INTO action_reviews (profile_id, id, action_id, reviewed_at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                seed.profile.id,
                id,
                action_id,
                reviewed_at,
                review.to_string()
            ],
        )
        .map_err(map_sqlite_err)?;
    }

    Ok(())
}

fn delete_profile_children_tx(
    tx: &rusqlite::Transaction<'_>,
    profile_id: &str,
) -> Result<(), CommandError> {
    let tables = [
        "observations",
        "observation_corrections",
        "drafts",
        "checkin_events",
        "personal_references",
        "action_reviews",
        "import_batches",
        "schedules",
        "profile_clock_history",
    ];
    for table in tables {
        let sql = format!("DELETE FROM {table} WHERE profile_id = ?1");
        tx.execute(&sql, params![profile_id]).map_err(map_sqlite_err)?;
    }
    Ok(())
}

fn insert_observation_tx(
    tx: &rusqlite::Transaction<'_>,
    profile_id: &str,
    origin_draft_id: Option<&str>,
    import_batch_id: Option<&str>,
    obs: &Value,
    obs_id: &str,
    metric: &str,
) -> Result<(), CommandError> {
    let timing = obs.get("timing");
    let timing_kind = timing
        .and_then(|t| t.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("instant");
    let observed_at = timing
        .and_then(|t| t.get("observedAtUtc").or_else(|| t.get("observedAt")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let period_ending_day = timing
        .and_then(|t| t.get("endingMissionDay"))
        .and_then(|v| v.as_i64());
    let source_row_id = obs
        .get("sourceRowId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let created_at = obs
        .get("recordedAtUtc").or_else(|| obs.get("recordedAt"))
        .or_else(|| obs.get("createdAt"))
        .and_then(|v| v.as_str())
        .unwrap_or("2026-11-13T07:18:00Z");
    let updated_at = obs
        .get("updatedAt").or_else(|| obs.get("recordedAtUtc"))
        .and_then(|v| v.as_str())
        .unwrap_or(created_at);

    tx.execute(
        "INSERT INTO observations (
            profile_id, id, origin_draft_id, metric, timing_kind,
            observed_at, period_ending_day, import_batch_id, source_row_id,
            created_at, updated_at, payload_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            profile_id,
            obs_id,
            origin_draft_id,
            metric,
            timing_kind,
            observed_at,
            period_ending_day,
            import_batch_id,
            source_row_id,
            created_at,
            updated_at,
            obs.to_string(),
        ],
    )
    .map_err(map_sqlite_err)?;
    Ok(())
}

fn count_observations_tx(
    tx: &rusqlite::Transaction<'_>,
    profile_id: &str,
) -> Result<usize, CommandError> {
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM observations WHERE profile_id = ?1",
            params![profile_id],
            |r| r.get(0),
        )
        .map_err(map_sqlite_err)?;
    Ok(count as usize)
}

fn str_field(v: &Value, key: &str) -> Result<String, CommandError> {
    v.get(key)
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            CommandError::with_detail(
                "MISSING_REQUIRED_FIELD",
                "Record payload is missing a required identifier or field.",
                key,
            )
        })
}

/// Reads the first non-empty string among `keys`. The shared TypeScript contract
/// names (`observationId`, `metricId`, `draftId`, ...) come first; the legacy
/// Rust-only names (`id`, `metric`) remain accepted so records written by the
/// first release still load.
fn str_any(v: &Value, keys: &[&str]) -> Result<String, CommandError> {
    keys.iter()
        .find_map(|k| {
            v.get(*k)
                .and_then(|x| x.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string())
        })
        .ok_or_else(|| {
            CommandError::with_detail(
                "MISSING_REQUIRED_FIELD",
                "Record payload is missing a required identifier or field.",
                keys.first().copied().unwrap_or(""),
            )
        })
}

/// Maps the shared `CheckInEvent.eventType` onto the stored `kind` column
/// (`unavailable` | `skipped`), accepting the legacy `kind` field as well.
fn event_kind(ev: &Value) -> Result<String, CommandError> {
    if let Some(t) = ev.get("eventType").and_then(|v| v.as_str()) {
        return match t {
            "measurement_unavailable" => Ok("unavailable".to_string()),
            "check_in_skipped" => Ok("skipped".to_string()),
            other => Err(CommandError::with_detail(
                "INVALID_EVENT_TYPE",
                "Check-in event type is not supported.",
                other,
            )),
        };
    }
    str_field(ev, "kind")
}

/// Returns preferences in the shared `AppPreferencesSchema` shape
/// (shared/src/contracts.ts): `appearance`, `activeProfileId`,
/// `displayUnits.{blood_glucose, body_temperature}`, `helpMode`, and the
/// optional persistent-storage flags. Legacy keys written by earlier desktop
/// builds (`displayUnits.glucose`, `displayUnits.temperature`,
/// `configuredHelpFixture`) are carried over; unknown or invalid values fall
/// back to the defaults so a full backup export always validates.
pub(crate) fn normalize_preferences(raw: Option<&Value>, active_profile_id: &str) -> Value {
    let get = |path: &[&str]| -> Option<&Value> {
        let mut cur = raw?;
        for key in path {
            cur = cur.get(*key)?;
        }
        Some(cur)
    };
    let pick = |candidates: &[&[&str]], allowed: &[&str], fallback: &str| -> String {
        candidates
            .iter()
            .filter_map(|path| get(path).and_then(Value::as_str))
            .find(|v| allowed.contains(v))
            .unwrap_or(fallback)
            .to_string()
    };

    let appearance = pick(&[&["appearance"]], &["system", "light", "dark"], "system");
    let glucose = pick(
        &[&["displayUnits", "blood_glucose"], &["displayUnits", "glucose"]],
        &["mg/dL", "mmol/L"],
        "mg/dL",
    );
    let temperature = pick(
        &[&["displayUnits", "body_temperature"], &["displayUnits", "temperature"]],
        &["C", "F"],
        "C",
    );
    let help_mode = match get(&["helpMode"]).and_then(Value::as_str) {
        Some("configured_fixture") => "configured_fixture",
        Some("unconfigured") => "unconfigured",
        _ => {
            if get(&["configuredHelpFixture"]).and_then(Value::as_bool) == Some(true) {
                "configured_fixture"
            } else {
                "unconfigured"
            }
        }
    };
    let saved_active = get(&["activeProfileId"])
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let active = if active_profile_id.is_empty() {
        saved_active.unwrap_or("sim-01")
    } else {
        active_profile_id
    };

    let mut out = json!({
        "appearance": appearance,
        "activeProfileId": active,
        "displayUnits": {
            "blood_glucose": glucose,
            "body_temperature": temperature
        },
        "helpMode": help_mode
    });
    for flag in ["persistentStorageRequested", "persistentStorageGranted"] {
        if let Some(b) = get(&[flag]).and_then(Value::as_bool) {
            out[flag] = json!(b);
        }
    }
    out
}

fn map_sqlite_err(err: rusqlite::Error) -> CommandError {
    CommandError::with_detail(
        "SQLITE_ERROR",
        "Local database operation failed safely without partial writes.",
        err.to_string(),
    )
}

fn map_json_err(err: serde_json::Error) -> CommandError {
    CommandError::with_detail(
        "JSON_DECODE_ERROR",
        "Stored JSON payload could not be decoded.",
        err.to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ConflictReplacement;
    use tempfile::tempdir;

    /// Payloads generated from the frontend's `buildDemoSeedInput()` (see
    /// desktop/tests/unit/bridge-contract.test.ts). Guards against the Rust side
    /// drifting from the shared contract field names again.
    const BRIDGE_CONTRACT: &str = include_str!("../tests/fixtures/sim01-bridge-contract.json");

    fn contract() -> Value {
        serde_json::from_str(BRIDGE_CONTRACT).expect("contract fixture parses")
    }

    fn obs_ids(bundle: &ProfileBundleData) -> Vec<String> {
        bundle
            .observations
            .iter()
            .map(|o| o["observationId"].as_str().unwrap_or_default().to_string())
            .collect()
    }

    #[test]
    fn guidance_review_revisions_are_profile_scoped_and_duplicate_taps_preserve_time() {
        let c = contract();
        let seed: ProfileSeedInput = serde_json::from_value(c["seed"].clone()).unwrap();
        let profile = seed.profile.id.clone();
        let dir = tempdir().unwrap();
        let path = dir.path().join("reviews.db");
        let db = Database::open_file(&path).unwrap();
        db.ensure_demo_seed_if_missing(seed).unwrap();
        let old = json!({"reviewId":"tuple-v1", "actionId":"action-review-sleep-routine", "profileId":profile,
            "observationId":"sleep-1", "referenceId":"ref-1", "referenceVersion":1, "ruleId":"sleep-rule", "ruleVersion":"v1",
            "sourceIds":["a","b"], "sourceVersions":{"a":"v1","b":"v1"}, "reviewed":true, "reviewedAtUtc":"2026-11-14T01:00:00Z"});
        let saved = db.record_action_review(&profile, old.clone()).unwrap();
        let mut duplicate = old.clone(); duplicate["reviewedAtUtc"] = json!("2026-11-14T02:00:00Z");
        assert_eq!(db.record_action_review(&profile, duplicate).unwrap(), saved);
        let mut fresh = old.clone(); fresh["reviewId"] = json!("tuple-v2"); fresh["sourceVersions"]["b"] = json!("v2");
        db.record_action_review(&profile, fresh).unwrap();
        let mut wrong = old.clone(); wrong["profileId"] = json!("another-profile");
        assert!(db.record_action_review(&profile, wrong).is_err());
        drop(db);
        let reopened = Database::open_file(&path).unwrap();
        let data = reopened.load_profile_bundle(&profile).unwrap();
        assert_eq!(data.action_reviews.iter().filter(|r| r["reviewId"]=="tuple-v1" || r["reviewId"]=="tuple-v2").count(), 2);
    }

    #[test]
    fn shared_contract_seed_save_restart_and_retry_through_sqlite() {
        let c = contract();
        let seed: ProfileSeedInput = serde_json::from_value(c["seed"].clone()).unwrap();
        let profile_id = seed.profile.id.clone();
        let dir = tempdir().unwrap();
        let path = dir.path().join("crewsignal.db");

        {
            let db = Database::open_file(&path).unwrap();
            // First launch: the production seed loads (previously MISSING_REQUIRED_FIELD: id).
            assert!(db.ensure_demo_seed_if_missing(seed.clone()).unwrap());
            let snap = db.load_app_snapshot(None).unwrap();
            assert_eq!(snap.profile_data.observations.len(), 11);
            assert_eq!(snap.profile_data.references.len(), seed.references.len());
            assert_eq!(snap.profile_data.drafts.len(), 1);
            // Records come back in the shared shape, with stable IDs preserved.
            let first = &seed.observations[0];
            assert!(obs_ids(&snap.profile_data)
                .contains(&first["observationId"].as_str().unwrap().to_string()));

            // Draft recovery: a retained draft round-trips under its draftId.
            let saved = db.save_draft(&profile_id, c["draft"].clone()).unwrap();
            assert!(saved.retained);

            let req = CommitObservationRequest {
                profile_id: profile_id.clone(),
                draft_id: "draft-contract-bp-0718".into(),
                observation: c["newObservation"].clone(),
            };
            let out = db.commit_observation(req.clone()).unwrap();
            assert_eq!(out.outcome, "committed");
            assert_eq!(out.profile_observation_count, 12);
            assert!(out.draft_closed);

            // Retrying the same draft keeps the count at 12.
            let again = db.commit_observation(req).unwrap();
            assert_eq!(again.outcome, "already_in_log");
            assert_eq!(again.profile_observation_count, 12);

            // Lost-ack lookup by draft alone finds the receipt.
            let lookup = db
                .check_observation_status(&profile_id, None, Some("draft-contract-bp-0718"))
                .unwrap();
            assert_eq!(lookup.state, "already_in_log");

            // Check-in events use eventType, not kind.
            let ev = db
                .commit_checkin_event(CommitCheckInEventRequest {
                    profile_id: profile_id.clone(),
                    event: c["event"].clone(),
                    discard_draft_id: None,
                })
                .unwrap();
            let _ = ev;

            // An explicit reference update supersedes the previous active version.
            db.upsert_personal_reference(&profile_id, c["updatedReference"].clone())
                .unwrap();
        }

        // Restart: reopen the same file.
        let db = Database::open_file(&path).unwrap();
        assert!(!db.ensure_demo_seed_if_missing(seed.clone()).unwrap());
        let bundle = db.load_profile_bundle(&profile_id).unwrap();
        assert_eq!(bundle.observations.len(), 12);
        let saved = bundle
            .observations
            .iter()
            .find(|o| o["observationId"] == "obs-contract-bp-0718")
            .expect("saved reading survives restart");
        assert_eq!(saved["sourceDraftId"], "draft-contract-bp-0718");
        let latest = bundle
            .observations
            .iter()
            .filter(|o| o["metricId"] == "blood_pressure")
            .max_by_key(|o| o["timing"]["observedAtUtc"].as_str().unwrap_or("").to_string())
            .unwrap();
        assert_eq!(latest["observationId"], "obs-contract-bp-0718");
        assert!(bundle
            .drafts
            .iter()
            .all(|d| d["draftId"] != "draft-contract-bp-0718"));
        assert_eq!(bundle.checkin_events.len(), 1);
        assert_eq!(bundle.checkin_events[0]["eventType"], "measurement_unavailable");

        let updated = &c["updatedReference"];
        let metric = updated["metricId"].as_str().unwrap();
        let same_metric: Vec<&Value> = bundle
            .references
            .iter()
            .filter(|r| r["metricId"] == metric)
            .collect();
        let active: Vec<&&Value> = same_metric.iter().filter(|r| r["status"] == "active").collect();
        assert_eq!(active.len(), 1, "exactly one active version: {same_metric:?}");
        assert_eq!(active[0]["referenceId"], updated["referenceId"]);
        assert!(same_metric.iter().any(|r| r["status"] == "superseded"));
    }

    #[test]
    fn restore_replace_rejects_cross_mode_and_leaves_records_intact() {
        let c = contract();
        let seed: ProfileSeedInput = serde_json::from_value(c["seed"].clone()).unwrap();
        let db = Database::open_in_memory().unwrap();
        db.ensure_demo_seed_if_missing(seed.clone()).unwrap();
        let mut personal = seed.profile.clone();
        personal.mode = "personal".into();
        let err = db
            .restore_backup(RestoreBackupRequest {
                target_mode: "replace_profile".into(),
                target_profile_id: Some(seed.profile.id.clone()),
                profile: personal,
                observations: vec![],
                corrections: vec![],
                checkin_events: vec![],
                references: vec![],
                action_reviews: vec![],
                schedules: vec![],
                clock_history: vec![],
            })
            .unwrap_err();
        assert_eq!(err.code, "RESTORE_MODE_MISMATCH");
        let bundle = db.load_profile_bundle(&seed.profile.id).unwrap();
        assert_eq!(bundle.observations.len(), 11);
    }

    fn demo_seed() -> ProfileSeedInput {
        ProfileSeedInput {
            profile: ProfileRecord {
                id: "sim-01".to_string(),
                mode: "demo".to_string(),
                alias: "Crew member 01".to_string(),
                mission_id: "SIM-01".to_string(),
                epoch_utc: "2026-10-03T00:00:00Z".to_string(),
                timezone: "UTC".to_string(),
                clock_version: 1,
                snapshot_utc: Some("2026-11-13T07:18:00Z".to_string()),
                created_at: "2026-10-03T00:00:00Z".to_string(),
                updated_at: "2026-11-13T07:18:00Z".to_string(),
                settings: json!({ "habitat": "Transit habitat" }),
            },
            observations: vec![
                json!({
                    "id": "obs-bp-0707",
                    "metric": "blood_pressure",
                    "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:07:00Z" },
                    "recordedAt": "2026-11-13T07:07:00Z",
                    "entered": { "systolic": 118, "diastolic": 76, "unit": "mmHg" }
                }),
                json!({
                    "id": "obs-hr-0705",
                    "metric": "resting_heart_rate",
                    "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:05:00Z" },
                    "recordedAt": "2026-11-13T07:05:00Z",
                    "entered": { "value": 72, "unit": "bpm" }
                }),
            ],
            references: vec![json!({
                "id": "demo-ref-sleep-v1",
                "metric": "sleep",
                "version": 1,
                "createdAt": "2026-10-03T00:00:00Z",
                "minutes": 444
            })],
            schedules: vec![],
            checkin_events: vec![],
            drafts: vec![json!({
                "id": "draft-bp-0718",
                "metric": "blood_pressure",
                "updatedAt": "2026-11-13T07:18:00Z",
                "systolic": "118",
                "diastolic": "76"
            })],
            action_reviews: vec![],
            clock_history: vec![],
        }
    }

    fn personal_profile(id: &str, alias: &str) -> ProfileRecord {
        ProfileRecord {
            id: id.to_string(),
            mode: "personal".to_string(),
            alias: alias.to_string(),
            mission_id: "PERS-01".to_string(),
            epoch_utc: "2026-11-13T00:00:00Z".to_string(),
            timezone: "Asia/Manila".to_string(),
            clock_version: 1,
            snapshot_utc: None,
            created_at: "2026-11-13T08:00:00Z".to_string(),
            updated_at: "2026-11-13T08:00:00Z".to_string(),
            settings: json!({}),
        }
    }

    #[test]
    fn atomic_commit_inserts_once_closes_only_target_draft_and_is_idempotent() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");

        // Keep a second unrelated draft so we prove only the committed draft closes.
        db.save_draft(
            "sim-01",
            json!({
                "id": "draft-temp-other",
                "metric": "temperature",
                "updatedAt": "2026-11-13T07:17:00Z",
                "value": "36.7"
            }),
        )
        .expect("second draft");

        let obs_payload = json!({
            "id": "obs-bp-0718",
            "metric": "blood_pressure",
            "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:18:00Z" },
            "recordedAt": "2026-11-13T07:18:00Z",
            "entered": { "systolic": 118, "diastolic": 76, "unit": "mmHg" }
        });

        let first = db
            .commit_observation(CommitObservationRequest {
                profile_id: "sim-01".to_string(),
                draft_id: "draft-bp-0718".to_string(),
                observation: obs_payload.clone(),
            })
            .expect("first commit");
        assert_eq!(first.outcome, "committed");
        assert!(first.draft_closed);
        assert_eq!(first.profile_observation_count, 3);

        // Retry with same ID / draft ID must return already_in_log and NOT insert a duplicate.
        let retry = db
            .commit_observation(CommitObservationRequest {
                profile_id: "sim-01".to_string(),
                draft_id: "draft-bp-0718".to_string(),
                observation: obs_payload,
            })
            .expect("idempotent retry");
        assert_eq!(retry.outcome, "already_in_log");
        assert_eq!(retry.profile_observation_count, 3);

        let bundle = db.load_profile_bundle("sim-01").expect("bundle");
        assert_eq!(bundle.observations.len(), 3);
        assert_eq!(bundle.drafts.len(), 1);
        assert_eq!(bundle.drafts[0]["id"], "draft-temp-other");
    }

    #[test]
    fn rollback_preserves_draft_and_leaves_observation_count_unchanged() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");

        db.set_hooks(DiagnosticHooks {
            simulate_commit_rollback: true,
            ..Default::default()
        });

        let err = db
            .commit_observation(CommitObservationRequest {
                profile_id: "sim-01".to_string(),
                draft_id: "draft-bp-0718".to_string(),
                observation: json!({
                    "id": "obs-bp-0718",
                    "metric": "blood_pressure",
                    "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:18:00Z" },
                    "recordedAt": "2026-11-13T07:18:00Z"
                }),
            })
            .expect_err("simulated rollback must fail");
        assert_eq!(err.code, "COMMIT_ROLLED_BACK");

        let bundle = db.load_profile_bundle("sim-01").expect("bundle");
        assert_eq!(bundle.observations.len(), 2);
        assert_eq!(bundle.drafts.len(), 1);
        assert_eq!(bundle.drafts[0]["id"], "draft-bp-0718");
    }

    #[test]
    fn lost_ack_commits_atomically_and_lookup_recovers_existing_receipt() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("crewsignal.db");
        let db = Database::open_file(&db_path).expect("file db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");

        db.set_hooks(DiagnosticHooks {
            simulate_lost_ack: true,
            ..Default::default()
        });

        let err = db
            .commit_observation(CommitObservationRequest {
                profile_id: "sim-01".to_string(),
                draft_id: "draft-bp-0718".to_string(),
                observation: json!({
                    "id": "obs-bp-0718",
                    "metric": "blood_pressure",
                    "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:18:00Z" },
                    "recordedAt": "2026-11-13T07:18:00Z"
                }),
            })
            .expect_err("lost ack returns unknown outcome");
        assert_eq!(err.code, "UNKNOWN_OUTCOME");

        // When lookup is unavailable, state is "unconfirmed"
        db.set_hooks(DiagnosticHooks {
            simulate_lookup_unavailable: true,
            ..Default::default()
        });
        let unconfirmed = db
            .check_observation_status("sim-01", Some("obs-bp-0718"), Some("draft-bp-0718"))
            .expect("lookup");
        assert_eq!(unconfirmed.state, "unconfirmed");

        // Once DB check succeeds, lookup finds the already-committed entry
        db.set_hooks(DiagnosticHooks::default());
        let confirmed = db
            .check_observation_status("sim-01", Some("obs-bp-0718"), Some("draft-bp-0718"))
            .expect("lookup");
        assert_eq!(confirmed.state, "already_in_log");
        assert_eq!(
            confirmed.observation.as_ref().and_then(|v| v["id"].as_str()),
            Some("obs-bp-0718")
        );

        let bundle = db.load_profile_bundle("sim-01").expect("bundle");
        assert_eq!(bundle.observations.len(), 3);
        assert_eq!(bundle.drafts.len(), 0);
    }

    #[test]
    fn strict_profile_isolation_demo_reset_and_personal_deletion() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");

        let p1 = db
            .create_personal_profile(personal_profile("pers-1", "Crew profile A"))
            .expect("create personal 1");
        let p1_bundle = db.load_profile_bundle(&p1.id).expect("p1 empty");
        assert_eq!(p1_bundle.observations.len(), 0);
        assert_eq!(p1_bundle.references.len(), 0);

        // Add observation in pers-1
        db.save_draft(
            &p1.id,
            json!({ "id": "d-p1", "metric": "temperature", "updatedAt": "2026-11-13T08:05:00Z" }),
        )
        .expect("p1 draft");
        db.commit_observation(CommitObservationRequest {
            profile_id: p1.id.clone(),
            draft_id: "d-p1".to_string(),
            observation: json!({
                "id": "obs-p1-1",
                "metric": "temperature",
                "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T08:05:00Z" },
                "recordedAt": "2026-11-13T08:05:00Z"
            }),
        })
        .expect("p1 commit");

        // Resetting demo MUST NOT alter personal profile!
        db.reset_demo_profile(demo_seed()).expect("reset demo");
        let p1_after_demo_reset = db.load_profile_bundle(&p1.id).expect("p1 intact");
        assert_eq!(p1_after_demo_reset.observations.len(), 1);

        // Deleting demo is forbidden
        let del_demo_err = db
            .delete_personal_profile("sim-01")
            .expect_err("cannot delete demo");
        assert_eq!(del_demo_err.code, "CANNOT_DELETE_DEMO_PROFILE");

        // Deleting pers-1 removes only pers-1 and falls back to sim-01
        let deleted = db
            .delete_personal_profile(&p1.id)
            .expect("delete personal");
        assert_eq!(deleted.deleted_profile_id, "pers-1");
        assert_eq!(deleted.fallback_profile_id, "sim-01");

        let snap = db.load_app_snapshot(None).expect("snapshot");
        assert_eq!(snap.profiles.len(), 1);
        assert_eq!(snap.active_profile_id, "sim-01");
    }

    #[test]
    fn csv_batch_commit_is_atomic_and_records_whole_bp_correction_history() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");

        // Simulated rollback leaves existing 07:07 BP intact and adds 0 new rows
        db.set_hooks(DiagnosticHooks {
            simulate_commit_rollback: true,
            ..Default::default()
        });
        let rollback_err = db
            .commit_csv_import_batch(CommitCsvBatchRequest {
                profile_id: "sim-01".to_string(),
                batch_id: "batch-1".to_string(),
                new_observations: vec![json!({
                    "id": "obs-hr-day40",
                    "metric": "resting_heart_rate",
                    "timing": { "kind": "instant", "observedAtUtc": "2026-11-11T07:00:00Z" },
                    "recordedAt": "2026-11-13T07:18:00Z"
                })],
                conflict_replacements: vec![],
                summary: json!({ "createdAt": "2026-11-13T07:18:00Z" }),
            })
            .expect_err("csv rollback");
        assert_eq!(rollback_err.code, "CSV_IMPORT_ROLLED_BACK");
        assert_eq!(db.load_profile_bundle("sim-01").unwrap().observations.len(), 2);

        // Now clear hooks and apply 2 valid rows + 1 whole BP pair conflict replacement
        db.set_hooks(DiagnosticHooks::default());
        let outcome = db
            .commit_csv_import_batch(CommitCsvBatchRequest {
                profile_id: "sim-01".to_string(),
                batch_id: "batch-1".to_string(),
                new_observations: vec![
                    json!({
                        "id": "obs-hr-day40",
                        "metric": "resting_heart_rate",
                        "timing": { "kind": "instant", "observedAtUtc": "2026-11-11T07:00:00Z" },
                        "recordedAt": "2026-11-13T07:18:00Z"
                    }),
                    json!({
                        "id": "obs-temp-day41",
                        "metric": "temperature",
                        "timing": { "kind": "instant", "observedAtUtc": "2026-11-12T07:00:00Z" },
                        "recordedAt": "2026-11-13T07:18:00Z"
                    }),
                ],
                conflict_replacements: vec![ConflictReplacement {
                    observation_id: "obs-bp-0707".to_string(),
                    previous_payload: json!({
                        "id": "obs-bp-0707",
                        "metric": "blood_pressure",
                        "entered": { "systolic": 118, "diastolic": 76, "unit": "mmHg" }
                    }),
                    new_payload: json!({
                        "id": "obs-bp-0707",
                        "metric": "blood_pressure",
                        "entered": { "systolic": 120, "diastolic": 78, "unit": "mmHg" }
                    }),
                    reason: "CSV conflict resolution: use imported pair".to_string(),
                    corrected_at: "2026-11-13T07:18:00Z".to_string(),
                }],
                summary: json!({ "createdAt": "2026-11-13T07:18:00Z" }),
            })
            .expect("csv batch");
        assert_eq!(outcome.outcome, "committed");
        assert_eq!(outcome.inserted_count, 2);
        assert_eq!(outcome.replaced_count, 1);

        let bundle = db.load_profile_bundle("sim-01").unwrap();
        assert_eq!(bundle.observations.len(), 4);
        assert_eq!(bundle.corrections.len(), 1);
        assert_eq!(bundle.corrections[0]["next"]["entered"]["systolic"], 120);
        assert_eq!(bundle.corrections[0]["next"]["entered"]["diastolic"], 78);

        // Reapplying same batch_id is idempotent
        let repeat = db
            .commit_csv_import_batch(CommitCsvBatchRequest {
                profile_id: "sim-01".to_string(),
                batch_id: "batch-1".to_string(),
                new_observations: vec![],
                conflict_replacements: vec![],
                summary: json!({}),
            })
            .expect("idempotent batch");
        assert_eq!(repeat.outcome, "already_applied");
    }

    #[test]
    fn restore_separate_and_replace_profiles_preserve_isolation_and_rollback_safely() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");

        // Restore into separate profile leaves sim-01 untouched
        let restored = db
            .restore_backup(RestoreBackupRequest {
                target_mode: "separate_profile".to_string(),
                target_profile_id: None,
                profile: personal_profile("restored-1", "Restored Demo Copy"),
                observations: vec![json!({
                    "id": "obs-bp-0707",
                    "metric": "blood_pressure",
                    "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:07:00Z" },
                    "recordedAt": "2026-11-13T07:07:00Z"
                })],
                corrections: vec![],
                checkin_events: vec![],
                references: vec![],
                action_reviews: vec![],
                schedules: vec![],
                clock_history: vec![],
            })
            .expect("restore separate");
        assert!(!restored.replaced_existing);
        assert_eq!(restored.observation_count, 1);
        assert_eq!(db.load_profile_bundle("sim-01").unwrap().observations.len(), 2);
        assert_eq!(db.load_profile_bundle("restored-1").unwrap().observations.len(), 1);

        // Simulated rollback during replace keeps existing profile intact
        db.set_hooks(DiagnosticHooks {
            simulate_commit_rollback: true,
            ..Default::default()
        });
        let err = db
            .restore_backup(RestoreBackupRequest {
                target_mode: "replace_profile".to_string(),
                target_profile_id: Some("restored-1".to_string()),
                profile: personal_profile("restored-1", "Overwritten"),
                observations: vec![],
                corrections: vec![],
                checkin_events: vec![],
                references: vec![],
                action_reviews: vec![],
                schedules: vec![],
                clock_history: vec![],
            })
            .expect_err("restore rollback");
        assert_eq!(err.code, "RESTORE_ROLLED_BACK");
        assert_eq!(db.load_profile_bundle("restored-1").unwrap().observations.len(), 1);
    }

    #[test]
    fn restore_keeps_demo_mode_and_round_trips_reviews_clock_history_and_corrections() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");
        let mut profile = personal_profile("restored-demo-h1", "SIM-01 (Restored)");
        profile.mode = "demo".to_string();
        profile.settings = json!({ "units": "metric" });
        let restored = db
            .restore_backup(RestoreBackupRequest {
                target_mode: "separate_profile".to_string(),
                target_profile_id: None,
                profile,
                observations: vec![json!({
                    "id": "obs-bp-0707",
                    "metric": "blood_pressure",
                    "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:07:00Z" },
                    "recordedAt": "2026-11-13T07:07:00Z"
                })],
                corrections: vec![json!({
                    "observationId": "obs-bp-0707",
                    "previousPayload": { "systolic": 121 },
                    "newPayload": { "systolic": 118 },
                    "reason": "Typo",
                    "correctedAt": "2026-11-13T07:10:00Z"
                })],
                checkin_events: vec![],
                references: vec![],
                action_reviews: vec![json!({
                    "reviewId": "rev-1",
                    "actionId": "action-review-sleep-routine",
                    "reviewedAtUtc": "2026-11-13T07:30:00Z",
                    "reviewed": true
                })],
                schedules: vec![],
                clock_history: vec![json!({
                    "profileId": "restored-demo-h1",
                    "clockVersion": 2,
                    "epochUtc": "2026-11-13T00:00:00Z",
                    "timezone": "Asia/Manila",
                    "changedAt": "2026-11-13T07:31:00Z"
                })],
            })
            .expect("restore separate");
        assert_eq!(restored.restored_profile.mode, "demo");

        let snap = db.load_app_snapshot(Some("restored-demo-h1")).unwrap();
        let rec = snap.profiles.iter().find(|p| p.id == "restored-demo-h1").unwrap();
        assert_eq!(rec.mode, "demo");
        assert_eq!(rec.settings["units"], json!("metric"));
        let data = db.load_profile_bundle("restored-demo-h1").unwrap();
        assert_eq!(data.action_reviews.len(), 1);
        assert_eq!(data.action_reviews[0]["reviewId"], json!("rev-1"));
        assert_eq!(data.clock_history.len(), 1);
        assert_eq!(data.clock_history[0]["timezone"], json!("Asia/Manila"));
        assert_eq!(data.corrections.len(), 1);
        assert_eq!(data.corrections[0]["observationId"], json!("obs-bp-0707"));
        // The public demo keeps none of the restored history.
        assert!(db.load_profile_bundle("sim-01").unwrap().action_reviews.is_empty());

        // A repeat import onto the same ID is refused and writes nothing.
        let again = db.restore_backup(RestoreBackupRequest {
            target_mode: "separate_profile".to_string(),
            target_profile_id: None,
            profile: rec.clone(),
            observations: vec![],
            corrections: vec![],
            checkin_events: vec![],
            references: vec![],
            action_reviews: vec![],
            schedules: vec![],
            clock_history: vec![],
        });
        assert!(again.is_err());
        assert_eq!(db.load_profile_bundle("restored-demo-h1").unwrap().action_reviews.len(), 1);
    }

    #[test]
    fn fallback_lock_writes_once_and_never_supersedes_an_existing_reference() {
        let c = contract();
        let seed: ProfileSeedInput = serde_json::from_value(c["seed"].clone()).unwrap();
        let profile_id = seed.profile.id.clone();
        let dir = tempdir().unwrap();
        let path = dir.path().join("crewsignal.db");
        let fallback = json!({
            "referenceId": format!("ref-{profile_id}-blood_glucose-fallback-v1"),
            "profileId": profile_id,
            "metricId": "blood_glucose",
            "version": 1,
            "provenance": "seven_day_fallback_median",
            "status": "active",
            "locked": true,
            "selectedObservationIds": ["a", "b", "c", "d", "e", "f", "g"],
            "createdAtUtc": "2026-11-13T07:18:00Z"
        });
        {
            let db = Database::open_file(&path).unwrap();
            db.ensure_demo_seed_if_missing(seed.clone()).unwrap();
            assert!(db.lock_fallback_reference(&profile_id, fallback.clone()).unwrap());
            // Repeated or concurrent attempts write nothing more.
            assert!(!db.lock_fallback_reference(&profile_id, fallback.clone()).unwrap());
            // A seeded metric (sleep has an entered reference) is never overwritten.
            let mut sleep = fallback.clone();
            sleep["metricId"] = json!("sleep");
            sleep["referenceId"] = json!("ref-x-sleep-fallback-v1");
            assert!(!db.lock_fallback_reference(&profile_id, sleep).unwrap());
            // Non-fallback payloads are refused.
            let mut wrong = fallback.clone();
            wrong["provenance"] = json!("user_updated");
            assert!(db.lock_fallback_reference(&profile_id, wrong).is_err());
        }
        // Restart: the lock and its representative IDs are still there; an explicit
        // update then supersedes it and keeps both versions.
        let db = Database::open_file(&path).unwrap();
        let glucose = |db: &Database| {
            db.load_app_snapshot(Some(profile_id.as_str()))
                .unwrap()
                .profile_data
                .references
                .into_iter()
                .filter(|r| r["metricId"] == json!("blood_glucose"))
                .collect::<Vec<_>>()
        };
        let refs = glucose(&db);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0]["selectedObservationIds"].as_array().unwrap().len(), 7);
        let explicit = json!({
            "referenceId": format!("ref-{profile_id}-blood_glucose-v2"),
            "profileId": profile_id,
            "metricId": "blood_glucose",
            "version": 2,
            "provenance": "user_updated",
            "status": "active",
            "createdAtUtc": "2026-11-13T08:00:00Z"
        });
        db.upsert_personal_reference(&profile_id, explicit).unwrap();
        let mut refs = glucose(&db);
        refs.sort_by_key(|r| r["version"].as_i64());
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0]["status"], json!("superseded"));
        assert_eq!(refs[0]["selectedObservationIds"].as_array().unwrap().len(), 7);
        assert_eq!(refs[1]["status"], json!("active"));
        assert!(!db.lock_fallback_reference(&profile_id, fallback).unwrap());
    }

    #[test]
    fn commit_rejects_a_draft_or_payload_from_another_profile() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");
        db.create_personal_profile(personal_profile("personal-1", "Me"))
            .expect("personal");
        let personal_draft = json!({
            "draftId": "draft-personal-bp",
            "profileId": "personal-1",
            "metricId": "blood_pressure",
            "updatedAtUtc": "2026-11-13T07:18:00Z"
        });
        assert!(db.save_draft("personal-1", personal_draft).unwrap().retained);
        let before_demo = db.load_profile_bundle("sim-01").unwrap().observations.len();
        let observation = json!({
            "observationId": "obs-personal-bp",
            "profileId": "personal-1",
            "sourceDraftId": "draft-personal-bp",
            "metricId": "blood_pressure",
            "timing": { "kind": "instant", "observedAtUtc": "2026-11-13T07:18:00Z" },
            "recordedAtUtc": "2026-11-13T07:18:00Z"
        });

        // Personal payload sent to the Demo profile: refused, nothing written.
        let err = db
            .commit_observation(CommitObservationRequest {
                profile_id: "sim-01".to_string(),
                draft_id: "draft-personal-bp".to_string(),
                observation: observation.clone(),
            })
            .unwrap_err();
        assert_eq!(err.code, "COMMIT_SCOPE_MISMATCH");

        // Payload re-labelled for the Demo profile, but the draft is kept under Personal.
        let mut relabelled = observation.clone();
        relabelled["profileId"] = json!("sim-01");
        let err = db
            .commit_observation(CommitObservationRequest {
                profile_id: "sim-01".to_string(),
                draft_id: "draft-personal-bp".to_string(),
                observation: relabelled,
            })
            .unwrap_err();
        assert_eq!(err.code, "COMMIT_SCOPE_MISMATCH");

        // Payload from a different draft than the one being committed.
        let err = db
            .commit_observation(CommitObservationRequest {
                profile_id: "personal-1".to_string(),
                draft_id: "draft-other".to_string(),
                observation: observation.clone(),
            })
            .unwrap_err();
        assert_eq!(err.code, "COMMIT_SCOPE_MISMATCH");

        assert_eq!(
            db.load_profile_bundle("sim-01").unwrap().observations.len(),
            before_demo
        );
        let personal = db.load_profile_bundle("personal-1").unwrap();
        assert!(personal.observations.is_empty());
        assert_eq!(personal.drafts.len(), 1, "the Personal draft stays resumable");

        // Its own profile accepts it and closes the draft.
        let ok = db
            .commit_observation(CommitObservationRequest {
                profile_id: "personal-1".to_string(),
                draft_id: "draft-personal-bp".to_string(),
                observation,
            })
            .expect("own-profile commit");
        assert_eq!(ok.outcome, "committed");
        assert!(ok.draft_closed);
        assert_eq!(ok.profile_observation_count, 1);
        assert_eq!(
            db.load_profile_bundle("sim-01").unwrap().observations.len(),
            before_demo
        );
    }

    #[test]
    fn first_launch_preferences_use_the_shared_shape() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");
        let snap = db.load_app_snapshot(None).unwrap();
        let p = &snap.preferences;
        assert_eq!(p["appearance"], json!("system"));
        assert_eq!(p["activeProfileId"], json!(snap.active_profile_id));
        assert_eq!(p["displayUnits"]["blood_glucose"], json!("mg/dL"));
        assert_eq!(p["displayUnits"]["body_temperature"], json!("C"));
        assert_eq!(p["helpMode"], json!("unconfigured"));
        assert!(p.get("configuredHelpFixture").is_none());
        assert!(p["displayUnits"].get("glucose").is_none());
    }

    #[test]
    fn legacy_saved_preferences_are_normalized_on_load() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed_if_missing(demo_seed()).expect("seed");
        {
            let conn = db.lock_conn().unwrap();
            conn.execute(
                "UPDATE meta SET value = ?1 WHERE key = 'app_preferences'",
                params![json!({
                    "appearance": "dark",
                    "displayUnits": { "glucose": "mmol/L", "temperature": "F" },
                    "configuredHelpFixture": true,
                    "knownSourceUpdateFixture": false,
                    "offlineSetupIncompleteFixture": false
                })
                .to_string()],
            )
            .unwrap();
        }
        let snap = db.load_app_snapshot(None).unwrap();
        assert_eq!(
            snap.preferences,
            json!({
                "appearance": "dark",
                "activeProfileId": snap.active_profile_id,
                "displayUnits": { "blood_glucose": "mmol/L", "body_temperature": "F" },
                "helpMode": "configured_fixture"
            })
        );
        // Saving through the command stores the canonical shape too.
        let saved = db
            .update_preferences(json!({
                "appearance": "light",
                "displayUnits": { "glucose": "bogus", "temperature": "C" }
            }))
            .unwrap();
        assert_eq!(saved["displayUnits"]["blood_glucose"], json!("mg/dL"));
        assert_eq!(saved["helpMode"], json!("unconfigured"));
        assert_eq!(saved["activeProfileId"], json!(snap.active_profile_id));
    }
}
