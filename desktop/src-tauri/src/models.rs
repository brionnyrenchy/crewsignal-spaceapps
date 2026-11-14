use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(
        code: impl Into<String>,
        message: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: Some(detail.into()),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticHooks {
    pub simulate_draft_retention_failure: bool,
    pub simulate_commit_rollback: bool,
    pub simulate_lost_ack: bool,
    pub simulate_lookup_unavailable: bool,
    pub simulate_log_read_failure: bool,
    pub simulate_file_outcome: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRecord {
    pub id: String,
    pub mode: String,
    pub alias: String,
    pub mission_id: String,
    pub epoch_utc: String,
    pub timezone: String,
    pub clock_version: i64,
    pub snapshot_utc: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSeedInput {
    pub profile: ProfileRecord,
    pub observations: Vec<Value>,
    pub references: Vec<Value>,
    pub schedules: Vec<Value>,
    pub checkin_events: Vec<Value>,
    pub drafts: Vec<Value>,
    pub action_reviews: Vec<Value>,
    pub clock_history: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBundleData {
    pub profile_id: String,
    pub observations: Vec<Value>,
    pub corrections: Vec<Value>,
    pub drafts: Vec<Value>,
    pub checkin_events: Vec<Value>,
    pub references: Vec<Value>,
    pub action_reviews: Vec<Value>,
    pub schedules: Vec<Value>,
    pub clock_history: Vec<Value>,
    pub import_batches: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub active_profile_id: String,
    pub profiles: Vec<ProfileRecord>,
    pub preferences: Value,
    pub profile_data: ProfileBundleData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitObservationRequest {
    pub profile_id: String,
    pub draft_id: String,
    pub observation: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitObservationOutcome {
    pub outcome: String, // "committed" | "already_in_log"
    pub observation: Value,
    pub draft_closed: bool,
    pub profile_observation_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupCommitOutcome {
    pub state: String, // "already_in_log" | "not_found" | "unconfirmed"
    pub observation: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftOutcome {
    pub retained: bool,
    pub draft: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitCheckInEventRequest {
    pub profile_id: String,
    pub event: Value,
    pub discard_draft_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitCheckInEventOutcome {
    pub outcome: String, // "recorded" | "already_recorded"
    pub event: Value,
    pub discarded_draft_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReplacement {
    pub observation_id: String,
    pub previous_payload: Value,
    pub new_payload: Value,
    pub reason: String,
    pub corrected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitCsvBatchRequest {
    pub profile_id: String,
    pub batch_id: String,
    pub new_observations: Vec<Value>,
    pub conflict_replacements: Vec<ConflictReplacement>,
    pub summary: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitCsvBatchOutcome {
    pub outcome: String, // "committed" | "already_applied"
    pub inserted_count: usize,
    pub replaced_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupRequest {
    pub target_mode: String, // "separate_profile" | "replace_profile"
    pub target_profile_id: Option<String>,
    pub profile: ProfileRecord,
    pub observations: Vec<Value>,
    pub corrections: Vec<Value>,
    pub checkin_events: Vec<Value>,
    pub references: Vec<Value>,
    pub action_reviews: Vec<Value>,
    pub schedules: Vec<Value>,
    pub clock_history: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupOutcome {
    pub restored_profile: ProfileRecord,
    pub observation_count: usize,
    pub replaced_existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProfileOutcome {
    pub deleted_profile_id: String,
    pub fallback_profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteOutcome {
    pub status: String, // "saved" | "cancelled" | "permission_refused" | "error"
    pub path: Option<String>,
    pub bytes_written: Option<usize>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadOutcome {
    pub status: String, // "loaded" | "cancelled" | "permission_refused" | "error"
    pub path: Option<String>,
    pub file_name: Option<String>,
    pub content: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnvironmentInfo {
    pub platform: String,
    pub arch: String,
    pub app_version: String,
    pub webview2_version: Option<String>,
    pub db_path: String,
    pub sqlite_journal_mode: String,
    pub offline_assets_bundled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftGuardState {
    pub has_unfinished_draft: bool,
    pub has_unretained_draft: bool,
    pub draft_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub available: bool,
    pub code: Option<String>,
    pub message: Option<String>,
    pub detail: Option<String>,
    pub db_path: Option<String>,
}
