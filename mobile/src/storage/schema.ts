/**
 * SQLite schema DDL for CrewSignal native storage (schema version 1).
 * Every observation, draft, workflow event, reference, and review record is
 * scoped to its profile_id and protected by primary/unique constraints.
 */
export const CREWSIGNAL_DB_SCHEMA_VERSION = 1;

export const CREWSIGNAL_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  appearance TEXT NOT NULL,
  active_profile_id TEXT NOT NULL,
  display_unit_glucose TEXT NOT NULL,
  display_unit_temperature TEXT NOT NULL,
  help_mode TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  profile_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  alias TEXT,
  mode TEXT NOT NULL,
  scenario_id TEXT,
  mission_name TEXT NOT NULL,
  mission_epoch_utc TEXT NOT NULL,
  display_timezone TEXT NOT NULL,
  snapshot_utc TEXT,
  created_at_utc TEXT NOT NULL,
  clock_version INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  observation_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  timing_kind TEXT NOT NULL,
  observed_mission_day INTEGER NOT NULL,
  observed_at_utc TEXT,
  reported_at_utc TEXT,
  recorded_at_utc TEXT NOT NULL,
  source_draft_id TEXT,
  import_batch_id TEXT,
  quality TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, observation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_profile_draft
  ON observations (profile_id, source_draft_id)
  WHERE source_draft_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_observations_profile_metric
  ON observations (profile_id, metric_id, observed_mission_day);

CREATE TABLE IF NOT EXISTS check_in_drafts (
  draft_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  commit_status TEXT NOT NULL,
  committed_observation_id TEXT,
  updated_at_utc TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, draft_id)
);

CREATE TABLE IF NOT EXISTS check_in_events (
  event_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metric_id TEXT,
  attempted_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, event_id)
);

CREATE TABLE IF NOT EXISTS personal_references (
  reference_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, reference_id)
);

CREATE TABLE IF NOT EXISTS insight_reviews (
  review_key TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  insight_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  reviewed_at_utc TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, review_key)
);

CREATE TABLE IF NOT EXISTS import_batches (
  batch_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  committed_at_utc TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, batch_id)
);
`;
