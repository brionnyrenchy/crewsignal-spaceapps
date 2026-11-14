import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  EVIDENCE_REGISTRY,
  METRIC_DEFINITIONS,
  buildDraftRecoveryBundle,
  type CheckInDraft,
  type MetricId,
} from '../shared';
import { downloadJsonBundle } from '../utils/files';
import { Modal } from './Modal';

export function MeasurementHelpModal({
  open,
  metricId,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  metricId: MetricId;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const relevantSource =
    metricId === 'blood_glucose'
      ? EVIDENCE_REGISTRY['cdc-nhanes-glucose']
      : metricId === 'body_temperature'
        ? EVIDENCE_REGISTRY['nist-temperature-units']
        : metricId === 'sleep'
          ? EVIDENCE_REGISTRY['nasa-seven-ways-sleep']
          : EVIDENCE_REGISTRY['nasa-standard-measures'];

  return (
    <Modal
      open={open}
      title="Measurement & unit help"
      description="Cached local unit rules and recording guidance."
      onClose={onClose}
      initialFocusRef={closeRef}
      returnFocusRef={returnFocusRef}
    >
      <div className="cs-stack" style={{ gap: '12px' }}>
        <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
          <span className="cs-mono-stamp">{relevantSource?.publisher}</span>
          <strong>{relevantSource?.title}</strong>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {relevantSource?.summaryText}
          </p>
          <p className="cs-helper">{relevantSource?.limitations}</p>
        </div>

        <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
          <span className="cs-mono-stamp">CrewSignal manual entry rules</span>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            <li>Blood glucose converts using CDC NHANES factor mmol/L × 18.02 = mg/dL.</li>
            <li>Temperature converts using NIST identity °F = °C × 1.8 + 32.</li>
            <li>Sleep records duration of a period ending on a mission day; 0h 0m logs Reported no sleep.</li>
            <li>Both your entered value/unit and converted canonical value are preserved.</li>
          </ul>
        </div>

        <div className="cs-row" style={{ justifyContent: 'space-between' }}>
          {relevantSource && (
            <Link
              to={`/demo/sources/${relevantSource.sourceId}`}
              className="cs-btn cs-btn-secondary"
              onClick={onClose}
            >
              Open cached source
            </Link>
          )}
          <button
            ref={closeRef}
            type="button"
            className="cs-btn cs-btn-primary"
            onClick={onClose}
          >
            Back to check-in
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function UnitChangeModal({
  open,
  currentUnit,
  targetUnit,
  enteredValue,
  onCancel,
  onConfirmClearAndChange,
  returnFocusRef,
}: {
  open: boolean;
  currentUnit: string;
  targetUnit: string;
  enteredValue: string;
  onCancel: () => void;
  onConfirmClearAndChange: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      role="alertdialog"
      title="Change input unit?"
      description={`You have an entered reading (${enteredValue} ${currentUnit}). Changing the input unit to ${targetUnit} clears the typed field so a number is never silently re-labeled.`}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
    >
      <div className="cs-row" style={{ justifyContent: 'flex-end', marginTop: '12px' }}>
        <button
          ref={cancelRef}
          type="button"
          className="cs-btn cs-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="cs-btn cs-btn-primary"
          onClick={onConfirmClearAndChange}
        >
          Clear value and change unit
        </button>
      </div>
    </Modal>
  );
}

export function DiscardDraftModal({
  open,
  onKeep,
  onDiscard,
  returnFocusRef,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const keepRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      role="alertdialog"
      title="Discard draft?"
      description="This uncommitted check-in draft is stored only on this device until added to the log. Discarding removes it permanently."
      onClose={onKeep}
      initialFocusRef={keepRef}
      returnFocusRef={returnFocusRef}
    >
      <div className="cs-row" style={{ justifyContent: 'flex-end', marginTop: '12px' }}>
        <button
          ref={keepRef}
          type="button"
          className="cs-btn cs-btn-primary"
          onClick={onKeep}
        >
          Keep draft
        </button>
        <button
          type="button"
          className="cs-btn cs-btn-danger"
          onClick={onDiscard}
        >
          Discard draft
        </button>
      </div>
    </Modal>
  );
}

export function UpdateConfirmModal({
  open,
  hasUncommittedDraft,
  onLater,
  onReviewDraft,
  onInstallNow,
}: {
  open: boolean;
  hasUncommittedDraft: boolean;
  onLater: () => void;
  onReviewDraft: () => void;
  onInstallNow: () => void;
}) {
  const laterRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      role="alertdialog"
      title="Confirm Update"
      description={
        hasUncommittedDraft
          ? 'A newer version of CrewSignal is ready, but an uncommitted check-in draft is stored on this device. Finish, commit, or discard your draft before reloading.'
          : 'A newer version of CrewSignal is cached locally and ready to activate.'
      }
      onClose={onLater}
      initialFocusRef={laterRef}
    >
      {hasUncommittedDraft && (
        <div className="cs-banner" style={{ marginBottom: '12px' }}>
          <span>
            Update deferred while an uncommitted draft exists on this device.
          </span>
        </div>
      )}
      <div className="cs-row" style={{ justifyContent: 'flex-end', marginTop: '8px' }}>
        <button
          ref={laterRef}
          type="button"
          className="cs-btn cs-btn-secondary"
          onClick={onLater}
        >
          Later
        </button>
        {hasUncommittedDraft && (
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={onReviewDraft}
          >
            Review draft
          </button>
        )}
        <button
          type="button"
          className="cs-btn cs-btn-primary"
          disabled={hasUncommittedDraft}
          onClick={onInstallNow}
        >
          Install now
        </button>
      </div>
    </Modal>
  );
}

/**
 * Shown inside any confirmation whose action would delete the only copy of a
 * draft held in this tab. The surrounding dialog's cancel button is "stay", its
 * destructive button is the explicit discard, and this offers the export.
 */
export function UnretainedDraftNotice({
  drafts,
  profileLabel,
  onExported,
  title = 'Unsaved draft would be lost',
  message,
  testId,
}: {
  drafts: CheckInDraft[];
  profileLabel: string;
  onExported?: (filenames: string[]) => void;
  /** Overrides for notices about drafts that storage does hold but an action deletes. */
  title?: string;
  message?: (countLabel: string, names: string, pronoun: string) => string;
  testId?: string;
}) {
  if (drafts.length === 0) return null;
  const names = drafts
    .map((d) => METRIC_DEFINITIONS[d.metricId]?.name ?? d.metricId)
    .join(', ');
  const countLabel = drafts.length === 1 ? 'A draft' : `${drafts.length} drafts`;
  const pronoun = drafts.length === 1 ? 'it' : 'them';
  return (
    <div
      className="cs-banner cs-banner-error"
      role="alert"
      style={{ marginTop: '8px' }}
      data-testid={testId}
    >
      <div>
        <strong>{title}</strong>
        <span style={{ display: 'block', fontSize: '0.875rem' }}>
          {message
            ? message(countLabel, names, pronoun)
            : `${countLabel} (${names}) exist only in this browser tab because storage failed. Download a recovery copy first, or continue to discard ${pronoun}.`}
        </span>
      </div>
      <button
        type="button"
        className="cs-btn cs-btn-secondary"
        onClick={() => {
          const exportedAtUtc = new Date().toISOString();
          const files = drafts.map((draft) =>
            downloadJsonBundle(
              `crewsignal-draft-recovery-${draft.metricId}.json`,
              buildDraftRecoveryBundle({ draft, profileLabel, exportedAtUtc, includeNotes: false }),
            ).filename,
          );
          onExported?.(files);
        }}
      >
        Download recovery JSON
      </button>
    </div>
  );
}
