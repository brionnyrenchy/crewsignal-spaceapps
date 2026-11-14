import {
  type CheckInDraft,
  type CheckInEvent,
  type MetricId,
  type Observation,
  type ProfileConfig,
} from './contracts';
import { validateDraftForReview } from './metrics';

export interface CommitDraftPlan {
  ok: boolean;
  outcome: 'insert' | 'already_in_log' | 'validation_error';
  error: string | null;
  observation: Observation | null;
  draftToCloseId: string | null;
  existingObservation: Observation | null;
}

/**
 * Pure idempotent commit planner shared by browser IndexedDB and native SQLite adapters.
 * Both adapters MUST execute insertion of `observation` + deletion/closure of `draftToCloseId`
 * inside a single atomic transaction.
 * Repeated Add to log, retry after lost acknowledgement, or reopen checks `sourceDraftId`
 * and returns `already_in_log` with the existing receipt rather than duplicating records.
 */
export function planCommitDraft(params: {
  draft: CheckInDraft;
  existingObservations: readonly Observation[];
  observationId: string;
  committedAtUtc: string;
}): CommitDraftPlan {
  const { draft, existingObservations, observationId, committedAtUtc } = params;

  const existing = existingObservations.find(
    (obs) =>
      obs.profileId === draft.profileId &&
      (obs.sourceDraftId === draft.draftId ||
        (draft.committedObservationId !== null &&
          obs.observationId === draft.committedObservationId)),
  );

  if (existing) {
    return {
      ok: true,
      outcome: 'already_in_log',
      error: null,
      observation: existing,
      draftToCloseId: draft.draftId,
      existingObservation: existing,
    };
  }

  const validated = validateDraftForReview(draft, committedAtUtc);
  if (
    !validated.validationState.valid ||
    !validated.entered ||
    !validated.canonical ||
    !validated.timing
  ) {
    return {
      ok: false,
      outcome: 'validation_error',
      error:
        validated.validationState.announcement ??
        'Entry validation failed before commit.',
      observation: null,
      draftToCloseId: null,
      existingObservation: null,
    };
  }

  const observation: Observation = {
    observationId,
    profileId: draft.profileId,
    metricId: draft.metricId,
    timing: validated.timing,
    recordedAtUtc: committedAtUtc,
    entered: validated.entered,
    canonical: validated.canonical,
    method: draft.method,
    context: draft.context,
    provenance: draft.provenance,
    quality: draft.quality ?? 'valid',
    qualityNote: null,
    note: draft.note.trim().length > 0 ? draft.note.trim() : null,
    sourceDraftId: draft.draftId,
    importBatchId: null,
    correctionHistory: [],
  };

  return {
    ok: true,
    outcome: 'insert',
    error: null,
    observation,
    draftToCloseId: draft.draftId,
    existingObservation: null,
  };
}

export interface UnknownOutcomeResolution {
  status: 'already_in_log' | 'confirmed_not_saved' | 'unconfirmed';
  heading: string;
  message: string;
  existingObservation: Observation | null;
}

/**
 * Resolves an interrupted or unconfirmed commit acknowledgement by checking storage
 * for the stable draft identity (`sourceDraftId`).
 */
export function resolveUnknownCommitOutcome(params: {
  draftId: string;
  profileId: string;
  storageCheckSucceeded: boolean;
  existingObservations: readonly Observation[];
}): UnknownOutcomeResolution {
  if (!params.storageCheckSucceeded) {
    return {
      status: 'unconfirmed',
      heading: 'Addition unconfirmed',
      message:
        'Check the log for this entry before adding again. Stored records could not be checked.',
      existingObservation: null,
    };
  }

  const found = params.existingObservations.find(
    (o) => o.profileId === params.profileId && o.sourceDraftId === params.draftId,
  );

  if (found) {
    return {
      status: 'already_in_log',
      heading: 'Already in your log',
      message: 'Stored on this device. No duplicate entry was created.',
      existingObservation: found,
    };
  }

  return {
    status: 'confirmed_not_saved',
    heading: 'Log addition did not complete',
    message: 'Your draft is still ready in Review. You can try adding again or edit details.',
    existingObservation: null,
  };
}

export function createWorkflowEvent(params: {
  eventId: string;
  profileId: string;
  eventType: 'measurement_unavailable' | 'check_in_skipped';
  metricId: MetricId | null;
  reason: string | null;
  attemptedAtUtc: string;
  attemptedMissionDay: number;
  attemptedTimeLabel: string;
  missionEpochUtc: string;
  keptDraftId: string | null;
  committedCountInSession: number;
  recordedAtUtc: string;
}): CheckInEvent {
  return {
    eventId: params.eventId,
    profileId: params.profileId,
    eventType: params.eventType,
    metricId: params.metricId,
    reason:
      params.reason && params.reason.trim().length > 0
        ? params.reason.trim()
        : null,
    attemptedAtUtc: params.attemptedAtUtc,
    attemptedMissionDay: params.attemptedMissionDay,
    attemptedTimeLabel: params.attemptedTimeLabel,
    missionEpochUtc: params.missionEpochUtc,
    keptDraftId: params.keptDraftId,
    committedCountInSession: params.committedCountInSession,
    recordedAtUtc: params.recordedAtUtc,
  };
}

export function formatSkipOutcomeMessage(committedCountInSession: number): string {
  if (committedCountInSession <= 0) {
    return 'No measurements added in this check-in.';
  }
  if (committedCountInSession === 1) {
    return '1 measurement added in this check-in.';
  }
  return `${committedCountInSession} measurements added in this check-in.`;
}

export interface RestoreDestinationPlan {
  destination: 'separate_profile' | 'replace_existing';
  targetProfileId: string;
  targetLabel: string;
  requiresConfirmation: boolean;
  offerRecoveryCopy: boolean;
  warningMessage: string | null;
  /**
   * True when a replace names a profile that does not exist. The plan then has
   * no usable target: callers must reject, never write to `targetProfileId`.
   */
  targetMissing: boolean;
}

export function planProfileRestore(params: {
  sourceProfile: ProfileConfig;
  destination: 'separate_profile' | 'replace_existing';
  existingProfiles: readonly ProfileConfig[];
  targetExistingProfileId?: string;
  newProfileId: string;
}): RestoreDestinationPlan {
  if (params.destination === 'separate_profile') {
    const baseName = params.sourceProfile.label;
    const collision = params.existingProfiles.some((p) => p.label === baseName);
    return {
      destination: 'separate_profile',
      targetProfileId: params.newProfileId,
      targetLabel: collision ? `${baseName} (Restored)` : baseName,
      requiresConfirmation: false,
      offerRecoveryCopy: false,
      warningMessage: null,
      targetMissing: false,
    };
  }

  const existing = params.existingProfiles.find(
    (p) => p.profileId === params.targetExistingProfileId,
  );
  if (!existing) {
    // Never fall back to the backup's own profile ID: that would silently
    // write over a profile the user did not choose.
    return {
      destination: 'replace_existing',
      targetProfileId: '',
      targetLabel: '',
      requiresConfirmation: true,
      offerRecoveryCopy: false,
      warningMessage:
        'The profile you chose to replace is no longer on this device. Nothing was changed. Choose a target again.',
      targetMissing: true,
    };
  }
  return {
    destination: 'replace_existing',
    targetProfileId: existing.profileId,
    targetLabel: existing.label,
    requiresConfirmation: true,
    offerRecoveryCopy: true,
    warningMessage: `Replacing "${existing.label}" overwrites its existing observations, workflow events, references, and settings.`,
    targetMissing: false,
  };
}
