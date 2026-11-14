import { MeasurementEducation } from '../components/MeasurementEducation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  MF_FIXTURES,
  METRIC_DEFINITIONS,
  METRIC_ORDER,
  MOOD_SCALE_SPEC,
  SIM_01_OPTIONAL_BP_DRAFT,
  SLEEP_TYPE_LABELS,
  applyInputUnitChange,
  buildDraftRecoveryBundle,
  compareObservationToReference,
  formatDurationHoursMinutes,
  formatObservationDisplay,
  formatReviewEquivalent,
  getMoodLabel,
  missionDayAndTimeToUtc,
  planInputUnitChange,
  resolveActiveReference,
  ENTRY_CONFIRMED_NOTE,
  ENTRY_WARNING_HELP,
  validateDraftForReview,
  NEEDS_RECHECK_LABEL,
  NEEDS_RECHECK_HELP,
  createBlankDraft,
  type CheckInDraft,
  type MetricId,
  type Observation,
  type SleepType,
} from '../shared';
import { useAppState } from '../state/AppStateContext';
import { newDraftId } from '../state/workingDrafts';
import { useTabList } from '../components/useTabList';
import { SimulatedCommitError } from '../storage/repository';
import { downloadJsonBundle, parseJsonSafe } from '../utils/files';
import {
  DiscardDraftModal,
  MeasurementHelpModal,
  UnitChangeModal,
} from '../components/ConfirmModals';

type WorkflowReceipt =
  | {
      kind: 'committed';
      title: string;
      subtitle: string;
      observation: Observation;
    }
  | {
      kind: 'unconfirmed';
      title: string;
      subtitle: string;
      draftId: string;
    }
  | {
      kind: 'unavailable';
      metricName: string;
      reason: string;
      draftKept: boolean;
    }
  | {
      kind: 'skipped';
      message: string;
    };

export function CheckInPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    activeProfile,
    currentMissionDay,
    scheduleStatusByMetric,
    profileDrafts,
    profileObservations,
    profileReferences,
    preferences,
    saveDraft,
    discardDraft,
    commitDraft,
    verifyDraftCommit,
    recordWorkflowEvent,
    importDraftRecovery,
    announce,
    workingDrafts,
    rememberWorkingDraft,
    forgetWorkingDraft,
  } = useAppState();

  const missionEpoch = activeProfile?.missionEpochUtc ?? '2026-10-03T00:00:00Z';
  const requestedMetricParam = searchParams.get('metric') as MetricId | null;

  const isKnownMetric = (m: string | null): m is MetricId =>
    m !== null && (METRIC_ORDER as readonly string[]).includes(m);

  const blankDraftFor = (metricId: MetricId, pidOverride?: string): CheckInDraft => {
    const pid = pidOverride ?? activeProfile?.profileId ?? 'sim-01-crew-01';
    return createBlankDraft({
      draftId: newDraftId(pid, metricId),
      profileId: pid,
      mode: activeProfile?.mode ?? 'demo',
      metricId,
      missionEpochUtc: missionEpoch,
      proposedMissionDay: currentMissionDay,
      proposedTimeHHMM: '07:18',
      nowUtc: activeProfile?.snapshotUtc ?? new Date().toISOString(),
      preferredUnit:
        metricId === 'blood_glucose'
          ? preferences.displayUnits.blood_glucose
          : metricId === 'body_temperature'
            ? preferences.displayUnits.body_temperature
            : undefined,
    });
  };

  /**
   * Finds the draft to resume: the copy held in this tab wins (it may be
   * memory-only), then the retained one in browser storage. Without a metric,
   * the most recently edited draft for the profile is resumed.
   */
  const findResumableDraft = (pid: string, metricId?: MetricId): CheckInDraft | null => {
    // A draft whose ID already backs a stored observation was committed, even
    // if the acknowledgement was lost; resuming it would duplicate the entry.
    const committedDraftIds = new Set(
      profileObservations
        .filter((o) => o.profileId === pid && o.sourceDraftId)
        .map((o) => o.sourceDraftId as string),
    );
    const resumable = (d: CheckInDraft) =>
      d.profileId === pid && d.commitStatus !== 'committed' && !committedDraftIds.has(d.draftId);
    const candidates = new Map<MetricId, CheckInDraft>();
    for (const d of profileDrafts) {
      if (resumable(d)) candidates.set(d.metricId, d);
    }
    for (const d of Object.values(workingDrafts)) {
      if (resumable(d)) candidates.set(d.metricId, d);
    }
    if (metricId) return candidates.get(metricId) ?? null;
    let best: CheckInDraft | null = null;
    for (const d of candidates.values()) {
      if (!best || d.updatedAtUtc > best.updatedAtUtc) best = d;
    }
    return best;
  };

  const [draft, setDraft] = useState<CheckInDraft>(() => {
    const pid = activeProfile?.profileId ?? 'sim-01-crew-01';
    const requested = isKnownMetric(requestedMetricParam) ? requestedMetricParam : undefined;
    return (
      findResumableDraft(pid, requested) ??
      blankDraftFor(requested ?? 'blood_pressure', pid)
    );
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<WorkflowReceipt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retainingQuality, setRetainingQuality] = useState(false);
  const [committedInSession, setCommittedInSession] = useState(0);
  const [unavailableReason, setUnavailableReason] = useState(
    'Instrument unavailable during check-in',
  );
  const [showUnavailableBox, setShowUnavailableBox] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingUnitChange, setPendingUnitChange] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const primaryInputRef = useRef<HTMLInputElement | null>(null);
  const secondaryInputRef = useRef<HTMLInputElement | null>(null);
  const hoursInputRef = useRef<HTMLInputElement | null>(null);
  const minutesInputRef = useRef<HTMLInputElement | null>(null);
  const endingDayInputRef = useRef<HTMLInputElement | null>(null);
  const dayInputRef = useRef<HTMLInputElement | null>(null);
  const timeInputRef = useRef<HTMLInputElement | null>(null);
  const unitSelectRef = useRef<HTMLSelectElement | null>(null);
  const helpBtnRef = useRef<HTMLButtonElement | null>(null);
  const discardBtnRef = useRef<HTMLButtonElement | null>(null);
  const moodGroupRef = useRef<HTMLDivElement | null>(null);

  const hydratedProfileIdRef = useRef<string | null>(
    activeProfile?.profileId ?? null,
  );
  const appliedQueryMetricRef = useRef<string | null>(requestedMetricParam);

  // Sync IndexedDB draft ONLY when switching active profile (never overwrite local tab selection)
  useEffect(() => {
    const pid = activeProfile?.profileId ?? null;
    if (!pid || pid === hydratedProfileIdRef.current) return;
    hydratedProfileIdRef.current = pid;
    const requested = isKnownMetric(requestedMetricParam) ? requestedMetricParam : undefined;
    setDraft(findResumableDraft(pid, requested) ?? blankDraftFor(requested ?? 'blood_pressure', pid));
    setReceipt(null);
    setErrors({});
    setErrorBanner(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeProfile,
    profileDrafts,
    requestedMetricParam,
    missionEpoch,
    currentMissionDay,
    preferences.displayUnits,
  ]);

  // Honor an explicit ?metric= link (e.g. from Overview) when its value changes.
  // The current draft stays in the working set, so nothing typed is dropped.
  useEffect(() => {
    if (
      isKnownMetric(requestedMetricParam) &&
      requestedMetricParam !== appliedQueryMetricRef.current &&
      !receipt
    ) {
      appliedQueryMetricRef.current = requestedMetricParam;
      const pid = activeProfile?.profileId ?? 'sim-01-crew-01';
      if (draft.metricId !== requestedMetricParam) {
        setDraft(findResumableDraft(pid, requestedMetricParam) ?? blankDraftFor(requestedMetricParam, pid));
      }
      setErrors({});
      setErrorBanner(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedMetricParam, receipt]);

  // Keep every in-progress draft in app state so leaving Check-in, opening Help
  // or choosing another measurement never loses it (including memory-only drafts).
  useEffect(() => {
    if (receipt?.kind === 'committed') return;
    if (draft.commitStatus === 'committed') return;
    rememberWorkingDraft(draft);
  }, [draft, receipt, rememberWorkingDraft]);

  const metricDef = METRIC_DEFINITIONS[draft.metricId];
  const persistSeqRef = useRef(0);

  const persistDraftState = async (edited: CheckInDraft) => {
    const seq = ++persistSeqRef.current;
    // Every edit stamps the draft so "Resume draft" reopens the latest one.
    const next = { ...edited, updatedAtUtc: new Date().toISOString() };
    setDraft(next);
    try {
      const retained = await saveDraft(next);
      if (seq === persistSeqRef.current) {
        setDraft(retained);
      }
    } catch {
      if (seq === persistSeqRef.current) {
        setDraft((prev) => ({
          ...prev,
          retentionStatus: 'memory_only',
        }));
      }
    }
  };

  const handleSelectMetric = (metricId: MetricId) => {
    // Invalidate any in-flight persist for the previous measurement.
    ++persistSeqRef.current;
    appliedQueryMetricRef.current = null;
    if (requestedMetricParam) {
      setSearchParams({}, { replace: true });
    }
    setReceipt(null);
    setErrors({});
    setErrorBanner(null);
    if (metricId === draft.metricId && !receipt) return;
    const pid = activeProfile?.profileId ?? 'sim-01-crew-01';
    // The draft being left stays retained (storage) and in the working set (memory).
    setDraft(findResumableDraft(pid, metricId) ?? blankDraftFor(metricId, pid));
  };

  const metricTabs = useTabList({
    ids: METRIC_ORDER,
    selected: draft.metricId,
    onSelect: (mId) => {
      void handleSelectMetric(mId);
    },
    idPrefix: 'checkin-metric',
    activation: 'manual',
  });

  const handleLoadFixture = async (fixtureId: string) => {
    const pid = activeProfile?.profileId ?? 'sim-01-crew-01';
    appliedQueryMetricRef.current = null;
    if (requestedMetricParam) {
      setSearchParams({}, { replace: true });
    }
    setReceipt(null);
    setErrors({});
    setErrorBanner(null);
    const nowIso = new Date().toISOString();
    if (fixtureId === 'CI-02') {
      await persistDraftState({
        ...SIM_01_OPTIONAL_BP_DRAFT,
        draftId: newDraftId(pid, 'ci02'),
        profileId: pid,
        missionEpochUtc: missionEpoch,
        stage: 'record',
        updatedAtUtc: nowIso,
      });
      return;
    }
    const found = MF_FIXTURES.find((f) => f.fixtureId === fixtureId);
    if (found) {
      await persistDraftState({
        ...found.draft,
        draftId: newDraftId(pid, found.fixtureId.toLowerCase()),
        profileId: pid,
        missionEpochUtc: missionEpoch,
        stage: 'record',
        updatedAtUtc: nowIso,
      });
    }
  };

  const focusField = (fieldName: string | null) => {
    if (!fieldName) return;
    window.requestAnimationFrame(() => {
      switch (fieldName) {
        case 'primary':
          primaryInputRef.current?.focus();
          break;
        case 'secondary':
          secondaryInputRef.current?.focus();
          break;
        case 'hours':
          hoursInputRef.current?.focus();
          break;
        case 'minutes':
          minutesInputRef.current?.focus();
          break;
        case 'endingMissionDay':
          endingDayInputRef.current?.focus();
          break;
        case 'observedMissionDay':
          dayInputRef.current?.focus();
          break;
        case 'observedTimeHHMM':
          timeInputRef.current?.focus();
          break;
        case 'moodScore':
          moodGroupRef.current?.querySelector('button')?.focus();
          break;
        default:
          primaryInputRef.current?.focus();
      }
    });
  };

  const handleNextReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    const validated = validateDraftForReview(draft);
    if (!validated.validationState.valid) {
      setErrors(validated.validationState.errors);
      const msg =
        validated.validationState.announcement ?? 'Check the highlighted fields.';
      setErrorBanner(msg);
      announce(msg);
      focusField(validated.validationState.firstInvalidField);
      return;
    }

    setErrors({});
    const reviewDraft: CheckInDraft = {
      ...draft,
      stage: 'review',
      validationState: validated.validationState,
      normalizedCandidate: validated.canonical,
      observedAtUtc:
        draft.metricId !== 'sleep' &&
        draft.observedMissionDay !== null &&
        draft.observedTimeHHMM
          ? missionDayAndTimeToUtc(
              draft.missionEpochUtc,
              draft.observedMissionDay,
              draft.observedTimeHHMM,
            )
          : draft.observedAtUtc,
    };
    await persistDraftState(reviewDraft);
  };

  const handleCommit = async () => {
    if (submitting || retainingQuality) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const outcome = await commitDraft(draft, Boolean(validationForReview.warning));
      forgetWorkingDraft(draft.profileId, draft.metricId);
      setCommittedInSession((c) => c + 1);
      setReceipt({
        kind: 'committed',
        title: outcome.receiptTitle,
        subtitle: outcome.receiptSubtitle,
        observation: outcome.observation,
      });
    } catch (err) {
      if (err instanceof SimulatedCommitError && err.kind === 'ack_lost') {
        const verification = await verifyDraftCommit(
          draft.draftId,
          draft.profileId,
        );
        if (verification.status === 'already_in_log' && verification.existingObservation) {
          forgetWorkingDraft(draft.profileId, draft.metricId);
          setCommittedInSession((c) => c + 1);
          setReceipt({
            kind: 'committed',
            title: verification.heading,
            subtitle: verification.message,
            observation: verification.existingObservation,
          });
        } else if (verification.status === 'unconfirmed') {
          setReceipt({
            kind: 'unconfirmed',
            title: verification.heading,
            subtitle: verification.message,
            draftId: draft.draftId,
          });
        } else {
          setErrorBanner(verification.message);
        }
      } else {
        setErrorBanner(
          err instanceof Error
            ? err.message
            : 'Could not save entry to this device. Your draft is preserved.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnitSelectChange = (targetUnit: string) => {
    if (targetUnit === draft.selectedUnit) return;
    const plan = planInputUnitChange(
      draft.rawFields.primary,
      draft.selectedUnit,
      targetUnit,
    );
    if (plan.requiresConfirmation) {
      setPendingUnitChange(targetUnit);
      return;
    }
    const next = applyInputUnitChange(
      draft,
      targetUnit,
      true,
      new Date().toISOString(),
    );
    void persistDraftState(next);
  };

  const validationForReview = useMemo(() => validateDraftForReview(draft), [draft]);

  const activeReferenceForDraft = useMemo(() => {
    if (draft.metricId === 'mood') return null;
    return resolveActiveReference({
      profileId: activeProfile?.profileId ?? draft.profileId,
      metricId: draft.metricId,
      references: profileReferences,
      observations: profileObservations,
      nowUtc: activeProfile?.snapshotUtc ?? new Date().toISOString(),
    });
  }, [draft.metricId, draft.profileId, activeProfile, profileReferences, profileObservations]);

  const reviewComparison = useMemo(() => {
    if (
      draft.stage !== 'review' ||
      !validationForReview.entered ||
      !validationForReview.canonical ||
      !validationForReview.timing
    ) {
      return null;
    }
    const previewObs: Observation = {
      observationId: 'preview',
      profileId: draft.profileId,
      metricId: draft.metricId,
      timing: validationForReview.timing,
      recordedAtUtc: draft.updatedAtUtc,
      entered: validationForReview.entered,
      canonical: validationForReview.canonical,
      method: draft.method,
      context: draft.context,
      provenance: draft.provenance,
      quality: draft.quality ?? 'valid',
      qualityNote: null,
      note: draft.note || null,
      sourceDraftId: draft.draftId,
      importBatchId: null,
      correctionHistory: [],
    };
    return compareObservationToReference(previewObs, activeReferenceForDraft);
  }, [draft, validationForReview, activeReferenceForDraft]);

  const equivalentReviewText = useMemo(() => {
    if (!validationForReview.entered) return null;
    if (
      (draft.metricId === 'blood_glucose' ||
        draft.metricId === 'body_temperature') &&
      validationForReview.entered.kind === 'scalar'
    ) {
      const info = formatReviewEquivalent(
        draft.metricId,
        validationForReview.entered.value,
        validationForReview.entered.unit,
      );
      if (!info) return null;
      const unitDisp =
        info.targetUnit === 'C'
          ? '°C'
          : info.targetUnit === 'F'
            ? '°F'
            : info.targetUnit;
      return `${info.label} (exact ${info.exact} ${unitDisp} · crewsignal-units-v1)`;
    }
    return null;
  }, [draft.metricId, validationForReview.entered]);

  const startFreshBlank = (metricId: MetricId = draft.metricId) => {
    setReceipt(null);
    setErrors({});
    setErrorBanner(null);
    if (searchParams.get('metric')) {
      setSearchParams({}, { replace: true });
    }
    setDraft(blankDraftFor(metricId));
  };

  if (receipt) {
    return (
      <div className="cs-stack" style={{ gap: '18px' }}>
        <header className="cs-page-header" style={{ marginBottom: 0 }}>
          <div>
            <span className="cs-mono-stamp">Check-in outcome</span>
            <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
              Check-in
            </h1>
          </div>
        </header>

        {receipt.kind === 'committed' && (
          <section className="cs-card cs-stack" aria-labelledby="receipt-heading">
            <div className="cs-banner cs-banner-saved">
              <div className="cs-row" style={{ gap: '10px' }}>
                <CheckCircle2 size={20} aria-hidden="true" />
                <div>
                  <h2 id="receipt-heading" className="cs-section-title">
                    {receipt.title}
                  </h2>
                  <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>
                    {receipt.subtitle}
                  </p>
                </div>
              </div>
              <span className="cs-pill cs-pill-saved">Stored receipt</span>
            </div>

            <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
              <span className="cs-mono-stamp">
                {METRIC_DEFINITIONS[receipt.observation.metricId].name}
              </span>
              <div className="cs-mono-value" style={{ fontSize: '1.375rem', fontWeight: 590 }}>
                {
                  formatObservationDisplay(
                    receipt.observation,
                    preferences.displayUnits,
                  ).primaryText
                }
              </div>
              {formatObservationDisplay(receipt.observation, preferences.displayUnits)
                .isConvertedDisplay && (
                <div className="cs-helper">
                  Entered:{' '}
                  {
                    formatObservationDisplay(
                      receipt.observation,
                      preferences.displayUnits,
                    ).enteredText
                  }
                </div>
              )}
              <div className="cs-helper">
                Method: {receipt.observation.method} · Context:{' '}
                {receipt.observation.context}
              </div>
              {receipt.observation.qualityNote === ENTRY_CONFIRMED_NOTE && <p>{ENTRY_CONFIRMED_NOTE}</p>}
            </div>

            <div className="cs-row">
              <Link to="/demo" className="cs-btn cs-btn-primary">
                Back to overview
              </Link>
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                onClick={() => startFreshBlank(receipt.observation.metricId)}
              >
                {receipt.observation.quality === 'questionable' ? 'Log a new reading' : 'Record another'}
              </button>
              <Link to="/demo/trends" className="cs-btn cs-btn-ghost">
                Check trends
              </Link>
            </div>
          </section>
        )}

        {receipt.kind === 'unconfirmed' && (
          <section className="cs-card cs-banner-error cs-stack" role="alert">
            <h2 className="cs-section-title">{receipt.title}</h2>
            <p>{receipt.subtitle}</p>
            <div className="cs-row">
              <button
                type="button"
                className="cs-btn cs-btn-primary"
                onClick={async () => {
                  const res = await verifyDraftCommit(
                    receipt.draftId,
                    activeProfile?.profileId ?? draft.profileId,
                  );
                  if (res.status === 'already_in_log' && res.existingObservation) {
                    // The stored log confirms this draft was saved: it must
                    // never be offered again as resumable work.
                    forgetWorkingDraft(draft.profileId, draft.metricId);
                    setCommittedInSession((c) => c + 1);
                    setReceipt({
                      kind: 'committed',
                      title: res.heading,
                      subtitle: res.message,
                      observation: res.existingObservation,
                    });
                  } else if (res.status === 'confirmed_not_saved') {
                    setReceipt(null);
                    setErrorBanner(res.message);
                  } else {
                    announce(res.message);
                  }
                }}
              >
                Check stored log
              </button>
              <Link to="/demo" className="cs-btn cs-btn-secondary">
                Open Overview
              </Link>
            </div>
          </section>
        )}

        {receipt.kind === 'unavailable' && (
          <section className="cs-card cs-stack">
            <h2 className="cs-section-title">
              Recorded: {receipt.metricName} unavailable
            </h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              Reason: {receipt.reason}.{' '}
              {receipt.draftKept
                ? 'Your open draft was kept on this device.'
                : 'Your existing log was left unchanged.'}
            </p>
            <div className="cs-row">
              <button
                type="button"
                className="cs-btn cs-btn-primary"
                onClick={() => setReceipt(null)}
              >
                Return to check-in
              </button>
              <Link to="/demo" className="cs-btn cs-btn-secondary">
                Back to overview
              </Link>
            </div>
          </section>
        )}

        {receipt.kind === 'skipped' && (
          <section className="cs-card cs-stack">
            <h2 className="cs-section-title">Check-in skipped</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{receipt.message}</p>
            <div className="cs-row">
              <Link to="/demo" className="cs-btn cs-btn-primary">
                Back to overview
              </Link>
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                onClick={() => startFreshBlank('blood_pressure')}
              >
                Start another check-in
              </button>
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="cs-stack" style={{ gap: '18px' }}>
      <header className="cs-page-header" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">
            {draft.stage === 'record' ? 'Step 1 of 2 · Record' : 'Step 2 of 2 · Review'}
          </span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Check-in
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Manual synthetic entry on this device. Review units, context, and timing before adding to the log.
          </p>
        </div>

        <div className="cs-row">
          <button
            ref={helpBtnRef}
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle size={16} aria-hidden="true" />
            <span>Measurement help</span>
          </button>

          <label className="cs-btn cs-btn-secondary" style={{ cursor: 'pointer' }}>
            <Upload size={16} aria-hidden="true" />
            <span>Recover draft JSON</span>
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const text = await file.text();
                const parsed = parseJsonSafe(text);
                if (!parsed.ok) {
                  setImportFeedback(parsed.error);
                  return;
                }
                const res = await importDraftRecovery(parsed.value);
                if (!res.valid || res.status === 'rejected') {
                  setImportFeedback(res.error ?? 'Draft recovery file rejected.');
                  return;
                }
                if (res.status === 'already_in_log' && res.existingCommittedObservation) {
                  setImportFeedback(
                    'Recovered draft is already in your log; no duplicate draft was opened.',
                  );
                  return;
                }
                if (res.bundle) {
                  setDraft(res.bundle.draft);
                  setImportFeedback('Recovered uncommitted draft onto this device.');
                }
              }}
            />
          </label>
        </div>
      </header>

      {draft.retentionStatus === 'memory_only' && (
        <div className="cs-banner cs-banner-error" role="alert">
          <div>
            <strong>Only on this screen</strong>
            <span style={{ marginLeft: '8px', fontSize: '0.875rem' }}>
              Browser storage could not keep this draft. It stays while this tab is open, including when you visit Help or another measurement. Download a recovery copy before closing or reloading.
            </span>
          </div>
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => {
              const bundle = buildDraftRecoveryBundle({
                draft,
                profileLabel: activeProfile?.label ?? 'SIM-01',
                exportedAtUtc: new Date().toISOString(),
                includeNotes: false,
              });
              const res = downloadJsonBundle(
                `crewsignal-draft-recovery-${draft.metricId}.json`,
                bundle,
              );
              announce(`Download requested: ${res.filename}. Check your Downloads.`);
              setErrorBanner(
                `Download requested (${res.filename}). Check your Downloads.`,
              );
            }}
          >
            Download recovery JSON
          </button>
        </div>
      )}

      {importFeedback && (
        <div className="cs-banner" role="status">
          <span>{importFeedback}</span>
          <button
            type="button"
            className="cs-btn cs-btn-ghost"
            onClick={() => setImportFeedback(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="cs-banner cs-banner-error" role="alert">
          <div className="cs-row" style={{ gap: '8px' }}>
            <AlertCircle size={18} aria-hidden="true" />
            <span>{errorBanner}</span>
          </div>
        </div>
      )}

      {/* Quick Metric Switcher + Fixture Helper */}
      {draft.stage === 'record' && (
        <section className="cs-card cs-stack" style={{ gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <span className="cs-mono-stamp">Select observation type</span>
            <div className="cs-row" style={{ gap: '6px', maxWidth: '100%', minWidth: 0 }}>
              <label htmlFor="fixture-loader" className="sr-only">
                Load synthetic fixture
              </label>
              <select
                id="fixture-loader"
                className="cs-select"
                style={{ width: '100%', maxWidth: '340px', minHeight: '44px', fontSize: '0.8125rem' }}
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    void handleLoadFixture(e.target.value);
                  }
                }}
              >
                <option value="">Load synthetic test fixture…</option>
                <option value="CI-02">CI-02 · Blood pressure 118/76 (Day 42 07:18)</option>
                {MF_FIXTURES.map((fx) => (
                  <option key={fx.fixtureId} value={fx.fixtureId}>
                    {fx.fixtureId} · {fx.description}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="cs-row" role="tablist" aria-label="Observation metrics">
            {METRIC_ORDER.map((mId) => {
              const def = METRIC_DEFINITIONS[mId];
              const active = draft.metricId === mId;
              return (
                <button
                  key={mId}
                  type="button"
                  {...metricTabs.getTabProps(mId)}
                  className={
                    active
                      ? 'cs-btn cs-btn-primary cs-btn-wrap'
                      : 'cs-btn cs-btn-secondary cs-btn-wrap'
                  }
                >
                  {def.shortLabel}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Stage 1: RECORD */}
      {draft.stage === 'record' && (
        <form
          onSubmit={handleNextReview}
          noValidate
          className="cs-card cs-stack"
          {...metricTabs.panelProps}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div>
              <h2 className="cs-section-title">{metricDef.name}</h2>
              <MeasurementEducation key={metricDef.id} definition={metricDef} collapsible />
              <p className="cs-helper">{metricDef.purpose}</p>
              {scheduleStatusByMetric[draft.metricId].status !== 'not_scheduled' && (
                <p className="cs-helper" style={{ marginTop: '4px' }}>
                  Schedule ({scheduleStatusByMetric[draft.metricId].intervalLabel} interval):{' '}
                  {scheduleStatusByMetric[draft.metricId].status === 'past_interval'
                    ? `Overdue · ${scheduleStatusByMetric[draft.metricId].ageLabel} since last entry`
                    : scheduleStatusByMetric[draft.metricId].status === 'within_interval'
                      ? `Within interval · last entry ${scheduleStatusByMetric[draft.metricId].ageLabel} ago`
                      : 'Due · no entries logged yet'}
                </p>
              )}
            </div>
            <span className="cs-pill">Draft kept on this device</span>
          </div>

          {/* Metric-Specific Inputs */}
          {draft.metricId === 'blood_pressure' && (
            <div className="cs-grid-2">
              <div>
                <label htmlFor="bp-systolic" className="cs-label">
                  Systolic (mmHg)
                </label>
                <input
                  ref={primaryInputRef}
                  id="bp-systolic"
                  type="text"
                  inputMode="decimal"
                  className="cs-input cs-mono-value"
                  aria-invalid={Boolean(errors.primary)}
                  aria-describedby={errors.primary ? 'err-primary' : undefined}
                  value={draft.rawFields.primary}
                  onChange={(e) => {
                    setErrors((prev) => ({ ...prev, primary: '' }));
                    void persistDraftState({
                      ...draft,
                      rawFields: { ...draft.rawFields, primary: e.target.value },
                    });
                  }}
                />
                {errors.primary && (
                  <p id="err-primary" className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                    {errors.primary}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="bp-diastolic" className="cs-label">
                  Diastolic (mmHg)
                </label>
                <input
                  ref={secondaryInputRef}
                  id="bp-diastolic"
                  type="text"
                  inputMode="decimal"
                  className="cs-input cs-mono-value"
                  aria-invalid={Boolean(errors.secondary)}
                  aria-describedby={errors.secondary ? 'err-secondary' : undefined}
                  value={draft.rawFields.secondary ?? ''}
                  onChange={(e) => {
                    setErrors((prev) => ({ ...prev, secondary: '' }));
                    void persistDraftState({
                      ...draft,
                      rawFields: { ...draft.rawFields, secondary: e.target.value },
                    });
                  }}
                />
                {errors.secondary && (
                  <p id="err-secondary" className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                    {errors.secondary}
                  </p>
                )}
              </div>
            </div>
          )}

          {draft.metricId === 'heart_rate' && (
            <div>
              <label htmlFor="hr-value" className="cs-label">
                Heart rate (bpm)
              </label>
              <input
                ref={primaryInputRef}
                id="hr-value"
                type="text"
                inputMode="decimal"
                className="cs-input cs-mono-value"
                aria-invalid={Boolean(errors.primary)}
                aria-describedby={errors.primary ? 'err-primary' : undefined}
                value={draft.rawFields.primary}
                onChange={(e) => {
                  setErrors((prev) => ({ ...prev, primary: '' }));
                  void persistDraftState({
                    ...draft,
                    rawFields: { ...draft.rawFields, primary: e.target.value },
                  });
                }}
              />
              {errors.primary && (
                <p id="err-primary" className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                  {errors.primary}
                </p>
              )}
            </div>
          )}

          {(draft.metricId === 'blood_glucose' ||
            draft.metricId === 'body_temperature') && (
            <div className="cs-grid-2">
              <div>
                <label htmlFor="scalar-value" className="cs-label">
                  {draft.metricId === 'blood_glucose'
                    ? 'Blood glucose reading'
                    : 'Body temperature reading'}
                </label>
                <input
                  ref={primaryInputRef}
                  id="scalar-value"
                  type="text"
                  inputMode="decimal"
                  className="cs-input cs-mono-value"
                  aria-invalid={Boolean(errors.primary)}
                  aria-describedby={errors.primary ? 'err-primary' : undefined}
                  value={draft.rawFields.primary}
                  onChange={(e) => {
                    setErrors((prev) => ({ ...prev, primary: '' }));
                    void persistDraftState({
                      ...draft,
                      rawFields: { ...draft.rawFields, primary: e.target.value },
                    });
                  }}
                />
                {errors.primary && (
                  <p id="err-primary" className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                    {errors.primary}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="input-unit-select" className="cs-label">
                  Input unit
                </label>
                <select
                  ref={unitSelectRef}
                  id="input-unit-select"
                  className="cs-select"
                  value={draft.selectedUnit}
                  onChange={(e) => handleUnitSelectChange(e.target.value)}
                >
                  {metricDef.acceptedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u === 'C' ? '°C (Celsius)' : u === 'F' ? '°F (Fahrenheit)' : u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {draft.metricId === 'sleep' && (
            <div className="cs-stack" style={{ gap: '14px' }}>
              <div className="cs-grid-3">
                <div>
                  <label htmlFor="sleep-type" className="cs-label">
                    Sleep period type
                  </label>
                  <select
                    id="sleep-type"
                    className="cs-select"
                    value={draft.rawFields.sleepType ?? 'main_sleep'}
                    onChange={(e) => {
                      const nextType = e.target.value as SleepType;
                      void persistDraftState({
                        ...draft,
                        context: SLEEP_TYPE_LABELS[nextType],
                        rawFields: { ...draft.rawFields, sleepType: nextType },
                      });
                    }}
                  >
                    <option value="main_sleep">Main sleep</option>
                    <option value="nap">Nap</option>
                    <option value="other">Other rest</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="sleep-hours" className="cs-label">
                    Hours asleep
                  </label>
                  <input
                    ref={hoursInputRef}
                    id="sleep-hours"
                    type="text"
                    inputMode="numeric"
                    className="cs-input cs-mono-value"
                    aria-invalid={Boolean(errors.hours)}
                    value={draft.rawFields.hours ?? ''}
                    onChange={(e) => {
                      setErrors((prev) => ({ ...prev, hours: '' }));
                      void persistDraftState({
                        ...draft,
                        rawFields: { ...draft.rawFields, hours: e.target.value },
                      });
                    }}
                  />
                  {errors.hours && (
                    <p className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                      {errors.hours}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="sleep-minutes" className="cs-label">
                    Minutes (0–59)
                  </label>
                  <input
                    ref={minutesInputRef}
                    id="sleep-minutes"
                    type="text"
                    inputMode="numeric"
                    className="cs-input cs-mono-value"
                    aria-invalid={Boolean(errors.minutes)}
                    value={draft.rawFields.minutes ?? ''}
                    onChange={(e) => {
                      setErrors((prev) => ({ ...prev, minutes: '' }));
                      void persistDraftState({
                        ...draft,
                        rawFields: { ...draft.rawFields, minutes: e.target.value },
                      });
                    }}
                  />
                  {errors.minutes && (
                    <p className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                      {errors.minutes}
                    </p>
                  )}
                </div>
              </div>

              {(draft.rawFields.hours === '0' &&
                (draft.rawFields.minutes === '0' || draft.rawFields.minutes === '')) && (
                <div className="cs-pill" role="status">
                  0h 0m · Reported no sleep for this period
                </div>
              )}

              <div className="cs-grid-2">
                <div>
                  <label htmlFor="sleep-ending-day" className="cs-label">
                    Ending mission day
                  </label>
                  <input
                    ref={endingDayInputRef}
                    id="sleep-ending-day"
                    type="text"
                    inputMode="numeric"
                    className="cs-input cs-mono-value"
                    aria-invalid={Boolean(errors.endingMissionDay)}
                    value={draft.rawFields.endingMissionDay ?? String(currentMissionDay)}
                    onChange={(e) => {
                      setErrors((prev) => ({ ...prev, endingMissionDay: '' }));
                      void persistDraftState({
                        ...draft,
                        rawFields: {
                          ...draft.rawFields,
                          endingMissionDay: e.target.value,
                        },
                      });
                    }}
                  />
                  {errors.endingMissionDay && (
                    <p className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                      {errors.endingMissionDay}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <label className="cs-row" style={{ minHeight: '44px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(draft.rawFields.hasSleepWindow)}
                      onChange={(e) => {
                        void persistDraftState({
                          ...draft,
                          rawFields: {
                            ...draft.rawFields,
                            hasSleepWindow: e.target.checked,
                            windowStartDay:
                              draft.rawFields.windowStartDay ??
                              String(Math.max(1, currentMissionDay - 1)),
                            windowStartTime: draft.rawFields.windowStartTime ?? '23:00',
                            windowEndDay:
                              draft.rawFields.windowEndDay ?? String(currentMissionDay),
                            windowEndTime: draft.rawFields.windowEndTime ?? '05:00',
                          },
                        });
                      }}
                    />
                    <span>Include optional bed/wake window</span>
                  </label>
                </div>
              </div>

              {draft.rawFields.hasSleepWindow && (
                <div className="cs-card-muted cs-stack" style={{ gap: '10px' }}>
                  <span className="cs-mono-stamp">Optional sleep window (supports midnight crossing)</span>
                  <div className="cs-grid-2">
                    <div>
                      <label htmlFor="win-start-day" className="cs-label">
                        Window start day
                      </label>
                      <input
                        id="win-start-day"
                        type="text"
                        inputMode="numeric"
                        className="cs-input cs-mono-value"
                        value={draft.rawFields.windowStartDay ?? ''}
                        onChange={(e) =>
                          void persistDraftState({
                            ...draft,
                            rawFields: {
                              ...draft.rawFields,
                              windowStartDay: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor="win-start-time" className="cs-label">
                        Start time (UTC HH:MM)
                      </label>
                      <input
                        id="win-start-time"
                        type="text"
                        className="cs-input cs-mono-value"
                        value={draft.rawFields.windowStartTime ?? ''}
                        onChange={(e) =>
                          void persistDraftState({
                            ...draft,
                            rawFields: {
                              ...draft.rawFields,
                              windowStartTime: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor="win-end-day" className="cs-label">
                        Window end day
                      </label>
                      <input
                        id="win-end-day"
                        type="text"
                        inputMode="numeric"
                        className="cs-input cs-mono-value"
                        aria-invalid={Boolean(errors.windowEndDay)}
                        value={draft.rawFields.windowEndDay ?? ''}
                        onChange={(e) =>
                          void persistDraftState({
                            ...draft,
                            rawFields: {
                              ...draft.rawFields,
                              windowEndDay: e.target.value,
                            },
                          })
                        }
                      />
                      {errors.windowEndDay && (
                        <p className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                          {errors.windowEndDay}
                        </p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="win-end-time" className="cs-label">
                        End time (UTC HH:MM)
                      </label>
                      <input
                        id="win-end-time"
                        type="text"
                        className="cs-input cs-mono-value"
                        value={draft.rawFields.windowEndTime ?? ''}
                        onChange={(e) =>
                          void persistDraftState({
                            ...draft,
                            rawFields: {
                              ...draft.rawFields,
                              windowEndTime: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {draft.metricId === 'mood' && (
            <div className="cs-stack" style={{ gap: '8px' }}>
              <span className="cs-label">{MOOD_SCALE_SPEC.questionText}</span>
              <p className="cs-helper">
                Custom 5-point self-report scale ({MOOD_SCALE_SPEC.scaleId}). Nothing is pre-selected until you choose.
              </p>
              <div
                ref={moodGroupRef}
                role="radiogroup"
                aria-label={MOOD_SCALE_SPEC.questionText}
                className="cs-row"
              >
                {MOOD_SCALE_SPEC.choices.map((choice) => {
                  const selected = draft.rawFields.moodScore === choice.score;
                  return (
                    <button
                      key={choice.score}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={
                        selected ? 'cs-btn cs-btn-primary' : 'cs-btn cs-btn-secondary'
                      }
                      onClick={() => {
                        setErrors((prev) => ({ ...prev, moodScore: '' }));
                        void persistDraftState({
                          ...draft,
                          rawFields: { ...draft.rawFields, moodScore: choice.score },
                        });
                      }}
                    >
                      {choice.score} · {choice.label}
                    </button>
                  );
                })}
              </div>
              {errors.moodScore && (
                <p className="cs-helper" style={{ color: 'var(--status-error-text)' }}>
                  {errors.moodScore}
                </p>
              )}
            </div>
          )}

          {/* Timing (for instant readings) */}
          {draft.metricId !== 'sleep' && (
            <div className="cs-grid-2">
              <div>
                <label htmlFor="obs-mission-day" className="cs-label">
                  Observed mission day
                </label>
                <input
                  ref={dayInputRef}
                  id="obs-mission-day"
                  type="text"
                  inputMode="numeric"
                  className="cs-input cs-mono-value"
                  aria-invalid={Boolean(errors.observedMissionDay)}
                  value={draft.observedMissionDay ?? ''}
                  onChange={(e) => {
                    const num = Number.parseInt(e.target.value, 10);
                    setErrors((prev) => ({ ...prev, observedMissionDay: '' }));
                    void persistDraftState({
                      ...draft,
                      observedMissionDay: Number.isNaN(num) ? null : num,
                    });
                  }}
                />
                {errors.observedMissionDay && (
                  <p className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                    {errors.observedMissionDay}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="obs-time-hhmm" className="cs-label">
                  Observed time (UTC HH:MM)
                </label>
                <input
                  ref={timeInputRef}
                  id="obs-time-hhmm"
                  type="text"
                  className="cs-input cs-mono-value"
                  aria-invalid={Boolean(errors.observedTimeHHMM)}
                  value={draft.observedTimeHHMM ?? ''}
                  onChange={(e) => {
                    setErrors((prev) => ({ ...prev, observedTimeHHMM: '' }));
                    void persistDraftState({
                      ...draft,
                      observedTimeHHMM: e.target.value,
                    });
                  }}
                />
                {errors.observedTimeHHMM && (
                  <p className="cs-helper" style={{ color: 'var(--status-error-text)', marginTop: '4px' }}>
                    {errors.observedTimeHHMM}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Method, Context & Optional Note */}
          <div className="cs-grid-2">
            <div>
              <label htmlFor="obs-method" className="cs-label">
                Measurement method
              </label>
              <select
                id="obs-method"
                className="cs-select"
                value={draft.method}
                onChange={(e) =>
                  void persistDraftState({ ...draft, method: e.target.value })
                }
              >
                {metricDef.methodOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="obs-context" className="cs-label">
                Measurement context
              </label>
              <select
                id="obs-context"
                className="cs-select"
                value={draft.context}
                onChange={(e) =>
                  void persistDraftState({ ...draft, context: e.target.value })
                }
              >
                {metricDef.contextOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="obs-note" className="cs-label">
              Optional private note (excluded from reports by default)
            </label>
            <textarea
              id="obs-note"
              className="cs-textarea"
              value={draft.note}
              onChange={(e) =>
                void persistDraftState({ ...draft, note: e.target.value })
              }
            />
          </div>

          {/* Form Action Row */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              paddingTop: '8px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div className="cs-row">
              {metricDef.supportsUnavailableInstrument && (
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={() => setShowUnavailableBox((s) => !s)}
                >
                  Measurement unavailable
                </button>
              )}
              <button
                type="button"
                className="cs-btn cs-btn-ghost"
                onClick={async () => {
                  await recordWorkflowEvent({
                    profileId: draft.profileId,
                    eventType: 'check_in_skipped',
                    metricId: draft.metricId,
                    reason: null,
                    attemptedAtUtc: new Date().toISOString(),
                    attemptedMissionDay: draft.observedMissionDay ?? currentMissionDay,
                    attemptedTimeLabel: draft.observedTimeHHMM ?? '07:18',
                    missionEpochUtc: draft.missionEpochUtc,
                    keptDraftId: null,
                    committedCountInSession: committedInSession,
                  });
                  setReceipt({
                    kind: 'skipped',
                    message:
                      committedInSession <= 0
                        ? 'No measurements added in this check-in.'
                        : `${committedInSession} measurement${committedInSession === 1 ? '' : 's'} added in this check-in.`,
                  });
                }}
              >
                Skip check-in
              </button>
              <button
                ref={discardBtnRef}
                type="button"
                className="cs-btn cs-btn-ghost"
                onClick={() => setDiscardOpen(true)}
              >
                <Trash2 size={15} aria-hidden="true" />
                <span>Discard draft</span>
              </button>
            </div>

            <button type="submit" className="cs-btn cs-btn-primary">
              Next: Review
            </button>
          </div>

          {showUnavailableBox && (
            <div className="cs-card-muted cs-stack" style={{ gap: '10px' }}>
              <label htmlFor="unavailable-reason" className="cs-label">
                Reason instrument is unavailable (preserves any typed draft)
              </label>
              <input
                id="unavailable-reason"
                type="text"
                className="cs-input"
                value={unavailableReason}
                onChange={(e) => setUnavailableReason(e.target.value)}
              />
              <div className="cs-row">
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={async () => {
                    await recordWorkflowEvent({
                      profileId: draft.profileId,
                      eventType: 'measurement_unavailable',
                      metricId: draft.metricId,
                      reason: unavailableReason,
                      attemptedAtUtc: new Date().toISOString(),
                      attemptedMissionDay: draft.observedMissionDay ?? currentMissionDay,
                      attemptedTimeLabel: draft.observedTimeHHMM ?? '07:18',
                      missionEpochUtc: draft.missionEpochUtc,
                      keptDraftId: draft.draftId,
                      committedCountInSession: committedInSession,
                    });
                    setShowUnavailableBox(false);
                    setReceipt({
                      kind: 'unavailable',
                      metricName: metricDef.shortLabel,
                      reason: unavailableReason,
                      draftKept: draft.retentionStatus === 'retained',
                    });
                  }}
                >
                  Confirm unavailable
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {/* Stage 2: REVIEW (Neutral appearance — no clinical warning coloring) */}
      {draft.stage === 'review' && (
        <section className="cs-card cs-stack" aria-labelledby="review-heading">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div>
              <span className="cs-mono-stamp">Review before adding to log</span>
              <h2 id="review-heading" className="cs-section-title" style={{ marginTop: '4px' }}>
                {metricDef.name}
              </h2>
            </div>
            <span className="cs-pill">Uncommitted draft</span>
          </div>

          <div className="cs-card-muted cs-stack" style={{ gap: '8px' }}>
            <div className="cs-mono-value" style={{ fontSize: '1.5rem', fontWeight: 590 }}>
              {draft.metricId === 'blood_pressure' &&
                `${draft.rawFields.primary}/${draft.rawFields.secondary} mmHg`}
              {draft.metricId === 'heart_rate' && `${draft.rawFields.primary} bpm`}
              {draft.metricId === 'blood_glucose' &&
                `${draft.rawFields.primary} ${draft.selectedUnit}`}
              {draft.metricId === 'body_temperature' &&
                `${draft.rawFields.primary} ${draft.selectedUnit === 'C' ? '°C' : '°F'}`}
              {draft.metricId === 'sleep' &&
                validationForReview.canonical?.kind === 'sleep_duration' &&
                `${formatDurationHoursMinutes(validationForReview.canonical.durationMinutes)}${
                  validationForReview.canonical.reportedNoSleep
                    ? ' · Reported no sleep'
                    : ''
                }`}
              {draft.metricId === 'mood' &&
                draft.rawFields.moodScore &&
                `${draft.rawFields.moodScore} · ${getMoodLabel(draft.rawFields.moodScore)}`}
            </div>

            {equivalentReviewText && (
              <div className="cs-helper">{equivalentReviewText}</div>
            )}

            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '10px',
                margin: 0,
              }}
            >
              <div>
                <dt className="cs-mono-stamp">Timing</dt>
                <dd style={{ marginTop: '2px' }}>
                  {draft.metricId === 'sleep'
                    ? `Ending Day ${draft.rawFields.endingMissionDay ?? currentMissionDay} · ${SLEEP_TYPE_LABELS[draft.rawFields.sleepType ?? 'main_sleep']}`
                    : `Day ${draft.observedMissionDay ?? currentMissionDay} · ${draft.observedTimeHHMM} UTC`}
                </dd>
              </div>
              <div>
                <dt className="cs-mono-stamp">Method</dt>
                <dd style={{ marginTop: '2px' }}>{draft.method}</dd>
              </div>
              <div>
                <dt className="cs-mono-stamp">Context</dt>
                <dd style={{ marginTop: '2px' }}>{draft.context}</dd>
              </div>
              <div>
                <dt className="cs-mono-stamp">Personal reference comparison</dt>
                <dd style={{ marginTop: '2px' }}>
                  {reviewComparison?.comparisonAvailable &&
                  reviewComparison.differenceText
                    ? reviewComparison.differenceText
                    : reviewComparison?.unavailableReason ??
                      'Comparison unavailable'}
                </dd>
              </div>
            </dl>
          </div>

          {validationForReview.warning && (
            <div id="entry-warning" className="cs-card-muted cs-stack" role="status">
              <strong>Confirm unusual value</strong>
              <p>{validationForReview.warning} {ENTRY_WARNING_HELP}</p>
            </div>
          )}
          <div>
            <label className="cs-row">
              <input
                type="checkbox"
                checked={draft.quality === 'questionable'}
                disabled={submitting || retainingQuality}
                aria-describedby="recheck-help"
                onChange={async (event) => {
                  const quality = event.target.checked ? 'questionable' : 'valid';
                  setRetainingQuality(true);
                  try {
                    await persistDraftState({ ...draft, quality });
                  } finally {
                    setRetainingQuality(false);
                  }
                }}
              />
              {NEEDS_RECHECK_LABEL}
            </label>
            <p id="recheck-help" className="cs-helper">{NEEDS_RECHECK_HELP}</p>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <button
              type="button"
              className="cs-btn cs-btn-secondary"
              disabled={submitting || retainingQuality}
              onClick={() =>
                void persistDraftState({ ...draft, stage: 'record' })
              }
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span>Edit details</span>
            </button>

            <div className="cs-row">
              <button
                type="button"
                className="cs-btn cs-btn-ghost"
                disabled={submitting}
                onClick={() => setDiscardOpen(true)}
              >
                <RotateCcw size={15} aria-hidden="true" />
                <span>Discard</span>
              </button>
              <button
                type="button"
                className="cs-btn cs-btn-primary"
                disabled={submitting || retainingQuality}
                aria-describedby={validationForReview.warning ? 'entry-warning' : undefined}
                onClick={() => {
                  void handleCommit();
                }}
              >
                {submitting ? 'Adding to log…' : validationForReview.warning ? 'Confirm and add to log' : 'Add to log'}
              </button>
            </div>
          </div>
        </section>
      )}

      <MeasurementHelpModal
        open={helpOpen}
        metricId={draft.metricId}
        onClose={() => setHelpOpen(false)}
        returnFocusRef={helpBtnRef}
      />

      <UnitChangeModal
        open={pendingUnitChange !== null}
        currentUnit={draft.selectedUnit}
        targetUnit={pendingUnitChange ?? ''}
        enteredValue={draft.rawFields.primary}
        onCancel={() => setPendingUnitChange(null)}
        onConfirmClearAndChange={() => {
          if (pendingUnitChange) {
            const next = applyInputUnitChange(
              draft,
              pendingUnitChange,
              true,
              new Date().toISOString(),
            );
            setPendingUnitChange(null);
            void persistDraftState(next);
            window.requestAnimationFrame(() => primaryInputRef.current?.focus());
          }
        }}
        returnFocusRef={unitSelectRef}
      />

      <DiscardDraftModal
        open={discardOpen}
        onKeep={() => setDiscardOpen(false)}
        onDiscard={async () => {
          setDiscardOpen(false);
          await discardDraft(draft.draftId);
          forgetWorkingDraft(draft.profileId, draft.metricId);
          startFreshBlank(draft.metricId);
        }}
        returnFocusRef={discardBtnRef}
      />
    </div>
  );
}
