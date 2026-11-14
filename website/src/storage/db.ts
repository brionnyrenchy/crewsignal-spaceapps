import Dexie, { type Table } from 'dexie';
import type {
  AppPreferences,
  CheckInDraft,
  CheckInEvent,
  EvidenceReference,
  Insight,
  Observation,
  PersonalReference,
  ProfileConfig,
} from '../shared';

export interface StoredPreferencesRow extends AppPreferences {
  id: 'singleton';
}

export interface MetaRow {
  key: string;
  value: string;
}

export class CrewSignalDatabase extends Dexie {
  profiles!: Table<ProfileConfig, string>;
  observations!: Table<Observation, string>;
  checkInDrafts!: Table<CheckInDraft, string>;
  checkInEvents!: Table<CheckInEvent, string>;
  references!: Table<PersonalReference, string>;
  insights!: Table<Insight, string>;
  preferences!: Table<StoredPreferencesRow, string>;
  sourceCache!: Table<EvidenceReference, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'crewsignal_web_v1') {
    super(name);
    this.version(1).stores({
      profiles: 'profileId, mode, scenarioId',
      observations:
        'observationId, profileId, metricId, sourceDraftId, recordedAtUtc, [profileId+metricId]',
      checkInDrafts: 'draftId, profileId, metricId, updatedAtUtc',
      checkInEvents: 'eventId, profileId, recordedAtUtc',
      references: 'referenceId, profileId, metricId, status, [profileId+metricId]',
      insights: 'insightId, profileId, observationId, status',
      preferences: 'id',
      sourceCache: 'sourceId',
      meta: 'key',
    });
  }
}

export const defaultDb = new CrewSignalDatabase();
