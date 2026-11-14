import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CSV_REVIEW_FIXTURE_CSV,
  SIM_01_PROFILE_ID,
  buildBackupBundle,
  computeBackupSummaryCounts,
  generateCsvTemplate,
  parseAndReconcileCsv,
  validateBackupImport,
  type AppearancePreference,
  type BackupBundle,
  type CsvConflictChoice,
  type CsvPossibleDuplicateChoice,
  type CsvReconciliationPreview,
  type GlucoseUnit,
  type TemperatureUnit,
} from '../shared';
import { useAppState } from '../state/AppStateContext';
import { Modal } from '../components/Modal';
import { UnretainedDraftNotice } from '../components/ConfirmModals';
import { downloadJsonBundle, downloadTextFile, parseJsonSafe } from '../utils/files';

export function SettingsPage() {
  const {
    preferences,
    setAppearance,
    setDisplayUnits,
    setHelpMode,
    profiles,
    activeProfile,
    profileObservations,
    profileEvents,
    profileReferences,
    profileInsights,
    switchProfile,
    commitCsvBatch,
    restoreBackup,
    deleteProfile,
    resetDemo,
    unretainedDrafts,
    profileDrafts,
    offlineDiagnostics,
    requestPersistence,
    refreshOfflineDiagnostics,
    setUpdateModalOpen,
    simulatedUpdatePending,
    setSimulatedUpdatePending,
    offlineSetupIncompleteOverride,
    setOfflineSetupIncompleteOverride,
    faultSimulation,
    setFaultSimulation,
    announce,
  } = useAppState();

  const [confirmAllProfileBackup, setConfirmAllProfileBackup] = useState(false);
  const [backupBanner, setBackupBanner] = useState<string | null>(null);

  // Staged backup restore preview state
  const [stagedBackup, setStagedBackup] = useState<BackupBundle | null>(null);
  const [restoreDestination, setRestoreDestination] = useState<
    'separate_profile' | 'replace_existing'
  >('separate_profile');
  const [confirmReplaceExisting, setConfirmReplaceExisting] = useState(false);
  // Replacing the active profile deletes its stored drafts in the same
  // transaction. Memory-only ones get the unsaved notice; saved ones get this.
  const activeUnretainedDrafts = unretainedDrafts.filter(
    (d) => d.profileId === activeProfile?.profileId,
  );
  const replacedSavedDrafts = profileDrafts.filter(
    (d) =>
      d.commitStatus === 'uncommitted' &&
      !activeUnretainedDrafts.some((u) => u.draftId === d.draftId),
  );
  const [restoreFeedback, setRestoreFeedback] = useState<string | null>(null);

  // CSV staged reconciliation state
  const [csvPreview, setCsvPreview] = useState<CsvReconciliationPreview | null>(
    null,
  );
  const [conflictChoices, setConflictChoices] = useState<
    Record<string, CsvConflictChoice>
  >({});
  const [dupChoices, setDupChoices] = useState<
    Record<string, CsvPossibleDuplicateChoice>
  >({});
  const [ackExclusions, setAckExclusions] = useState(false);
  const [csvFeedback, setCsvFeedback] = useState<string | null>(null);

  // Reset & Delete confirmation modals
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const keepResetRef = useRef<HTMLButtonElement | null>(null);
  const keepDeleteRef = useRef<HTMLButtonElement | null>(null);

  const backupCounts = useMemo(
    () =>
      computeBackupSummaryCounts({
        observations: profileObservations,
        checkInEvents: profileEvents,
        references: profileReferences,
      }),
    [profileObservations, profileEvents, profileReferences],
  );

  const stageCsvText = (csvText: string) => {
    if (!activeProfile) return;
    setCsvFeedback(null);
    const preview = parseAndReconcileCsv({
      csvText,
      existingObservations: profileObservations,
      profileId: activeProfile.profileId,
      missionEpochUtc: activeProfile.missionEpochUtc,
      importBatchId: `batch-${Date.now()}`,
      nowUtc: new Date().toISOString(),
    });
    setCsvPreview(preview);
    setConflictChoices({});
    setDupChoices({});
    setAckExclusions(false);
  };

  const handleDownloadFullBackup = () => {
    if (!activeProfile || !confirmAllProfileBackup) return;
    const bundle = buildBackupBundle({
      confirmedIncludeAllProfileData: true,
      exportedAtUtc: new Date().toISOString(),
      profile: activeProfile,
      preferences,
      observations: profileObservations,
      checkInEvents: profileEvents,
      references: profileReferences,
      insights: profileInsights,
    });
    const res = downloadJsonBundle(
      `crewsignal-backup-${activeProfile.profileId}.json`,
      bundle,
    );
    setBackupBanner(
      `Download requested (${res.filename}, ${res.byteLength} bytes). Check your Downloads.`,
    );
    announce(`Download requested for ${res.filename}.`);
  };

  return (
    <div className="cs-stack" style={{ gap: '20px' }}>
      <header className="cs-page-header" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">Preferences, Storage &amp; Portable Data</span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Settings
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Manage appearance, display units, offline storage verification, CSV reconciliation, and synthetic demo backups.
          </p>
        </div>
      </header>

      {/* Appearance & Display Units */}
      <section className="cs-card cs-stack" aria-labelledby="pref-heading">
        <h2 id="pref-heading" className="cs-section-title">
          Appearance &amp; Display Units
        </h2>

        <div className="cs-grid-3">
          <div>
            <span className="cs-label">Appearance</span>
            <div className="cs-row" role="group" aria-label="Theme preference">
              {(['system', 'light', 'dark'] as AppearancePreference[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={preferences.appearance === opt}
                  className={
                    preferences.appearance === opt
                      ? 'cs-btn cs-btn-primary'
                      : 'cs-btn cs-btn-secondary'
                  }
                  onClick={() => void setAppearance(opt)}
                >
                  {opt[0]!.toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="pref-glucose-unit" className="cs-label">
              Blood glucose display unit
            </label>
            <select
              id="pref-glucose-unit"
              className="cs-select"
              value={preferences.displayUnits.blood_glucose}
              onChange={(e) =>
                void setDisplayUnits({
                  ...preferences.displayUnits,
                  blood_glucose: e.target.value as GlucoseUnit,
                })
              }
            >
              <option value="mg/dL">mg/dL</option>
              <option value="mmol/L">mmol/L</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-temp-unit" className="cs-label">
              Body temperature display unit
            </label>
            <select
              id="pref-temp-unit"
              className="cs-select"
              value={preferences.displayUnits.body_temperature}
              onChange={(e) =>
                void setDisplayUnits({
                  ...preferences.displayUnits,
                  body_temperature: e.target.value as TemperatureUnit,
                })
              }
            >
              <option value="C">°C (Celsius)</option>
              <option value="F">°F (Fahrenheit)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Synthetic Scenario Switcher & Demo Reset / Profile Delete */}
      <section className="cs-card cs-stack" aria-labelledby="scenarios-heading">
        <h2 id="scenarios-heading" className="cs-section-title">
          Synthetic demo profiles
        </h2>
        <p className="cs-helper">
          Public website demo uses isolated synthetic profiles (SIM-01, SIM-SCHEDULE, SIM-EMPTY) stored locally in IndexedDB.
        </p>

        <div className="cs-row" style={{ gap: '8px' }}>
          {profiles.map((p) => {
            const active = p.profileId === activeProfile?.profileId;
            return (
              <div key={p.profileId} className="cs-row" style={{ gap: '4px' }}>
                <button
                  type="button"
                  aria-pressed={active}
                  className={active ? 'cs-btn cs-btn-primary' : 'cs-btn cs-btn-secondary'}
                  onClick={() => void switchProfile(p.profileId)}
                >
                  {p.alias ? `${p.alias} (${p.label})` : p.label}
                </button>
                {p.profileId !== SIM_01_PROFILE_ID && profiles.length > 1 && (
                  <button
                    type="button"
                    className="cs-btn cs-btn-ghost"
                    aria-label={`Delete profile ${p.label}`}
                    onClick={() => setDeleteTargetId(p.profileId)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="cs-row" style={{ paddingTop: '6px' }}>
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => setResetModalOpen(true)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>Reset demo data</span>
          </button>
        </div>
      </section>

      {/* Offline PWA & Persistence Diagnostics */}
      <section className="cs-card cs-stack" aria-labelledby="offline-heading">
        <h2 id="offline-heading" className="cs-section-title">
          Offline capability &amp; device persistence
        </h2>
        <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
          <div>
            <strong>Status:</strong> {offlineDiagnostics.detailMessage}
          </div>
          <div className="cs-helper">
            Connectivity: {offlineDiagnostics.online ? 'Online' : 'Offline'} · Service worker controller:{' '}
            {offlineDiagnostics.controllerActive ? 'Active' : 'Not controlling'} · Cached entries:{' '}
            <span className="cs-tabular">{offlineDiagnostics.cacheEntryCount}</span> · Storage persistence:{' '}
            <strong>
              {offlineDiagnostics.persistence === 'granted'
                ? 'Granted (eviction-protected)'
                : offlineDiagnostics.persistence === 'refused'
                  ? 'Browser declined persistent storage'
                  : offlineDiagnostics.persistence}
            </strong>
          </div>
        </div>

        <div className="cs-row">
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => void refreshOfflineDiagnostics()}
          >
            Refresh offline status
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => void requestPersistence()}
          >
            Request persistent storage
          </button>
          {offlineDiagnostics.updateWaiting && (
            <button
              type="button"
              className="cs-btn cs-btn-primary"
              onClick={() => setUpdateModalOpen(true)}
            >
              Review waiting app update
            </button>
          )}
        </div>
      </section>

      {/* Full Profile Backup Export & Staged Restore */}
      <section className="cs-card cs-stack" aria-labelledby="backup-heading">
        <h2 id="backup-heading" className="cs-section-title">
          Backup &amp; Restore (BackupBundle JSON)
        </h2>
        <p className="cs-helper">
          Current profile includes <span className="cs-tabular">{backupCounts.observationCount}</span> observations,{' '}
          <span className="cs-tabular">{backupCounts.moodCount}</span> mood entries,{' '}
          <span className="cs-tabular">{backupCounts.noteCount}</span> notes, and{' '}
          <span className="cs-tabular">{backupCounts.referenceCount}</span> personal references. Personal-mode bundles are rejected in this public synthetic web demo.
        </p>

        {backupBanner && (
          <div className="cs-banner cs-banner-saved" role="status">
            <div className="cs-row" style={{ gap: '8px' }}>
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>{backupBanner}</span>
            </div>
          </div>
        )}

        <label className="cs-row" style={{ minHeight: '44px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={confirmAllProfileBackup}
            onChange={(e) => setConfirmAllProfileBackup(e.target.checked)}
          />
          <span>Include all profile data (mood entries, notes, events, and references)</span>
        </label>

        <div className="cs-row">
          <button
            type="button"
            className="cs-btn cs-btn-primary"
            disabled={!confirmAllProfileBackup}
            onClick={handleDownloadFullBackup}
          >
            <Download size={16} aria-hidden="true" />
            <span>Download full backup JSON</span>
          </button>

          <label className="cs-btn cs-btn-secondary" style={{ cursor: 'pointer' }}>
            <Upload size={16} aria-hidden="true" />
            <span>Inspect backup file to restore</span>
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setRestoreFeedback(null);
                setStagedBackup(null);
                const parsed = parseJsonSafe(await file.text());
                if (!parsed.ok) {
                  setRestoreFeedback(parsed.error);
                  return;
                }
                const check = validateBackupImport(parsed.value, {
                  rejectPersonalInPublicDemo: true,
                });
                if (!check.valid || !check.bundle) {
                  setRestoreFeedback(check.error ?? 'Backup rejected.');
                  return;
                }
                setStagedBackup(check.bundle);
                setRestoreDestination('separate_profile');
                setConfirmReplaceExisting(false);
              }}
            />
          </label>
        </div>

        {restoreFeedback && (
          <div className="cs-banner" role="status">
            <span>{restoreFeedback}</span>
          </div>
        )}

        {stagedBackup && (
          <div className="cs-card-muted cs-stack" style={{ gap: '10px' }}>
            <span className="cs-mono-stamp">Staged backup restore preview</span>
            <div>
              <strong>{stagedBackup.profile.label}</strong> ·{' '}
              {stagedBackup.summaryCounts.observationCount} observations ·{' '}
              {stagedBackup.summaryCounts.moodCount} mood entries ·{' '}
              {stagedBackup.summaryCounts.noteCount} notes
            </div>
            <div className="cs-stack" style={{ gap: '6px' }}>
              <label className="cs-row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="restore-dest"
                  checked={restoreDestination === 'separate_profile'}
                  onChange={() => setRestoreDestination('separate_profile')}
                />
                <span>Restore into a separate synthetic profile (recommended)</span>
              </label>
              <label className="cs-row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="restore-dest"
                  checked={restoreDestination === 'replace_existing'}
                  onChange={() => setRestoreDestination('replace_existing')}
                />
                <span>Replace active profile ({activeProfile?.label})</span>
              </label>
            </div>

            {restoreDestination === 'replace_existing' && (
              <div className="cs-stack" style={{ gap: '8px' }}>
                <p className="cs-helper" style={{ color: 'var(--status-error-text)' }}>
                  Warning: Replacing {activeProfile?.label} overwrites its current observations and references.
                </p>
                <label className="cs-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={confirmReplaceExisting}
                    onChange={(e) => setConfirmReplaceExisting(e.target.checked)}
                  />
                  <span>
                    Confirm replacing active synthetic profile
                    {replacedSavedDrafts.length + activeUnretainedDrafts.length > 0
                      ? ', including its open drafts'
                      : ''}
                  </span>
                </label>
                <UnretainedDraftNotice
                  testId="restore-replace-draft"
                  drafts={replacedSavedDrafts}
                  profileLabel={activeProfile?.label ?? 'SIM-01'}
                  title={`Replacing ${activeProfile?.label ?? 'this profile'} removes its open drafts`}
                  message={(count, names, pronoun) =>
                    `${count} (${names}) saved in this browser will be deleted with the old profile data. Download a recovery copy first to keep ${pronoun}.`
                  }
                  onExported={(f) => announce(`Download requested: ${f.join(', ')}. Check your Downloads.`)}
                />
                <UnretainedDraftNotice
                  drafts={activeUnretainedDrafts}
                  profileLabel={activeProfile?.label ?? 'SIM-01'}
                  onExported={(f) => announce(`Download requested: ${f.join(', ')}. Check your Downloads.`)}
                />
              </div>
            )}

            <div className="cs-row">
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                onClick={() => setStagedBackup(null)}
              >
                Cancel restore
              </button>
              <button
                type="button"
                className="cs-btn cs-btn-primary"
                disabled={
                  restoreDestination === 'replace_existing' && !confirmReplaceExisting
                }
                onClick={async () => {
                  try {
                    const res = await restoreBackup({
                      rawInput: stagedBackup,
                      destination: restoreDestination,
                      targetExistingProfileId: activeProfile?.profileId,
                      confirmedReplace: confirmReplaceExisting,
                    });
                    setRestoreFeedback(`Restored into ${res.profile.label}.`);
                    setStagedBackup(null);
                  } catch (err) {
                    setRestoreFeedback(
                      err instanceof Error ? err.message : 'Restore failed.',
                    );
                  }
                }}
              >
                Confirm restore
              </button>
            </div>
          </div>
        )}
      </section>

      {/* CSV Export & Staged 5-Row Review Import */}
      <section className="cs-card cs-stack" aria-labelledby="csv-heading">
        <h2 id="csv-heading" className="cs-section-title">
          CSV template &amp; staged import reconciliation
        </h2>
        <p className="cs-helper">
          Validates units strictly, detects exact duplicates and whole-pair blood pressure conflicts, and requires review before changing your log.
        </p>

        <div className="cs-row">
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => {
              const res = downloadTextFile(
                'crewsignal-template.csv',
                generateCsvTemplate(),
                'text/csv;charset=utf-8',
              );
              setCsvFeedback(
                `Download requested (${res.filename}). Check your Downloads.`,
              );
            }}
          >
            <Download size={15} aria-hidden="true" />
            <span>Download CSV template</span>
          </button>

          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => stageCsvText(CSV_REVIEW_FIXTURE_CSV)}
          >
            Load 5-row review fixture
          </button>

          <label className="cs-btn cs-btn-secondary" style={{ cursor: 'pointer' }}>
            <Upload size={15} aria-hidden="true" />
            <span>Choose CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                stageCsvText(await file.text());
              }}
            />
          </label>
        </div>

        {csvFeedback && (
          <div className="cs-banner cs-banner-saved" role="status">
            <span>{csvFeedback}</span>
          </div>
        )}

        {csvPreview && (
          <div className="cs-card-muted cs-stack" style={{ gap: '12px' }}>
            <div>
              <strong>CSV preview:</strong>{' '}
              <span className="cs-mono-value">{csvPreview.summaryLine}</span>
            </div>

            {!csvPreview.validHeader ? (
              <div className="cs-banner cs-banner-error" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{csvPreview.headerError}</span>
              </div>
            ) : (
              <>
                <div className="cs-table-wrap" tabIndex={0} role="region" aria-label="CSV import reconciliation table">
                  <table className="cs-table">
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">ID &amp; Indicator</th>
                        <th scope="col">Status</th>
                        <th scope="col">Resolution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.rows.map((row) => (
                        <tr key={`${row.rowIndex}-${row.observationId}`}>
                          <td className="cs-mono-value">#{row.rowIndex}</td>
                          <td>
                            <div className="cs-mono-value">{row.observationId}</div>
                            <div className="cs-helper">{row.metricId}</div>
                          </td>
                          <td>
                            <span
                              className={
                                row.classification === 'rejected'
                                  ? 'cs-pill cs-pill-error'
                                  : row.classification === 'valid'
                                    ? 'cs-pill cs-pill-saved'
                                    : 'cs-pill'
                              }
                            >
                              {row.classification}
                            </span>
                            {row.reason && (
                              <div className="cs-helper" style={{ marginTop: '4px' }}>
                                {row.reason}
                              </div>
                            )}
                          </td>
                          <td>
                            {row.classification === 'conflict' && (
                              <div className="cs-row" style={{ gap: '8px' }}>
                                <label className="cs-row" style={{ cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name={`conflict-${row.observationId}`}
                                    checked={
                                      conflictChoices[row.observationId] === 'keep_current'
                                    }
                                    onChange={() =>
                                      setConflictChoices((prev) => ({
                                        ...prev,
                                        [row.observationId]: 'keep_current',
                                      }))
                                    }
                                  />
                                  <span>Keep current</span>
                                </label>
                                <label className="cs-row" style={{ cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name={`conflict-${row.observationId}`}
                                    checked={
                                      conflictChoices[row.observationId] === 'use_imported'
                                    }
                                    onChange={() =>
                                      setConflictChoices((prev) => ({
                                        ...prev,
                                        [row.observationId]: 'use_imported',
                                      }))
                                    }
                                  />
                                  <span>Use imported whole entry</span>
                                </label>
                              </div>
                            )}
                            {row.classification === 'possible_duplicate' && (
                              <div className="cs-row" style={{ gap: '8px' }}>
                                <label className="cs-row" style={{ cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name={`dup-${row.observationId}`}
                                    checked={dupChoices[row.observationId] === 'skip'}
                                    onChange={() =>
                                      setDupChoices((prev) => ({
                                        ...prev,
                                        [row.observationId]: 'skip',
                                      }))
                                    }
                                  />
                                  <span>Skip</span>
                                </label>
                                <label className="cs-row" style={{ cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name={`dup-${row.observationId}`}
                                    checked={
                                      dupChoices[row.observationId] === 'keep_separate'
                                    }
                                    onChange={() =>
                                      setDupChoices((prev) => ({
                                        ...prev,
                                        [row.observationId]: 'keep_separate',
                                      }))
                                    }
                                  />
                                  <span>Keep separate</span>
                                </label>
                              </div>
                            )}
                            {(row.classification === 'valid' ||
                              row.classification === 'duplicate' ||
                              row.classification === 'rejected') && (
                              <span className="cs-helper">
                                {row.classification === 'valid'
                                  ? 'Ready to insert'
                                  : 'Excluded from insert'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(csvPreview.counts.duplicate > 0 ||
                  csvPreview.counts.rejected > 0 ||
                  Object.values(conflictChoices).includes('keep_current') ||
                  Object.values(dupChoices).includes('skip')) && (
                  <label className="cs-row" style={{ minHeight: '44px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={ackExclusions}
                      onChange={(e) => setAckExclusions(e.target.checked)}
                    />
                    <span>
                      Acknowledge excluded/rejected/duplicate rows before committing import
                    </span>
                  </label>
                )}

                <div className="cs-row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="cs-btn cs-btn-secondary"
                    onClick={() => setCsvPreview(null)}
                  >
                    Clear preview
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-primary"
                    onClick={async () => {
                      if (!activeProfile) return;
                      try {
                        const res = await commitCsvBatch({
                          profileId: activeProfile.profileId,
                          preview: csvPreview,
                          conflictChoices,
                          possibleDuplicateChoices: dupChoices,
                          acknowledgedExclusions: ackExclusions,
                        });
                        setCsvFeedback(
                          `Imported CSV batch: ${res.insertedCount} added, ${res.updatedCount} updated, ${res.skippedCount} skipped.`,
                        );
                        setCsvPreview(null);
                      } catch (err) {
                        setCsvFeedback(
                          err instanceof Error ? err.message : 'Could not import CSV batch.',
                        );
                      }
                    }}
                  >
                    Commit reviewed CSV batch
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* Prototype Recovery & Verification Controls */}
      <details className="cs-card">
        <summary
          style={{
            cursor: 'pointer',
            fontWeight: 500,
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Recovery, Help fixture &amp; fault simulation controls (for verification)
        </summary>
        <div className="cs-stack" style={{ gap: '10px', marginTop: '12px' }}>
          <div className="cs-row" style={{ gap: '12px' }}>
            <label className="cs-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={preferences.helpMode === 'configured_fixture'}
                onChange={(e) =>
                  void setHelpMode(
                    e.target.checked ? 'configured_fixture' : 'unconfigured',
                  )
                }
              />
              <span>Enable Configured Help test fixture (C07)</span>
            </label>

            <label className="cs-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={simulatedUpdatePending}
                onChange={(e) => setSimulatedUpdatePending(e.target.checked)}
              />
              <span>Simulate SW update waiting (C08)</span>
            </label>

            <label className="cs-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={offlineSetupIncompleteOverride}
                onChange={(e) =>
                  setOfflineSetupIncompleteOverride(e.target.checked)
                }
              />
              <span>Simulate offline setup incomplete (C10)</span>
            </label>
          </div>

          <div className="cs-row" style={{ gap: '12px' }}>
            <label className="cs-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={faultSimulation.failDraftWrite}
                onChange={(e) =>
                  setFaultSimulation({ failDraftWrite: e.target.checked })
                }
              />
              <span>Simulate draft retention failure (ER-04)</span>
            </label>

            <label className="cs-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={faultSimulation.failCommitRollback}
                onChange={(e) =>
                  setFaultSimulation({ failCommitRollback: e.target.checked })
                }
              />
              <span>Simulate commit failure / rollback (ER-02)</span>
            </label>

            <label className="cs-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={faultSimulation.failCommitAckAfterWrite}
                onChange={(e) =>
                  setFaultSimulation({ failCommitAckAfterWrite: e.target.checked })
                }
              />
              <span>Simulate lost commit acknowledgement</span>
            </label>

            <label className="cs-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={faultSimulation.failPostCommitRead}
                onChange={(e) =>
                  setFaultSimulation({ failPostCommitRead: e.target.checked })
                }
              />
              <span>Simulate unconfirmed verification read (C09)</span>
            </label>
          </div>
        </div>
      </details>

      {/* Reset Demo Modal */}
      <Modal
        open={resetModalOpen}
        role="alertdialog"
        title="Reset demo data?"
        description="Restores SIM-01, SIM-SCHEDULE, and starter references to their clean baseline and clears added drafts/entries."
        onClose={() => setResetModalOpen(false)}
        initialFocusRef={keepResetRef}
      >
        <UnretainedDraftNotice
          drafts={unretainedDrafts}
          profileLabel={activeProfile?.label ?? 'SIM-01'}
          onExported={(f) => announce(`Download requested: ${f.join(', ')}. Check your Downloads.`)}
        />
        <div className="cs-row" style={{ justifyContent: 'flex-end', marginTop: '12px' }}>
          <button
            ref={keepResetRef}
            type="button"
            className="cs-btn cs-btn-primary"
            onClick={() => setResetModalOpen(false)}
          >
            Keep demo
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-danger"
            onClick={async () => {
              setResetModalOpen(false);
              await resetDemo();
            }}
          >
            Reset demo data
          </button>
        </div>
      </Modal>

      {/* Delete Profile Modal */}
      <Modal
        open={deleteTargetId !== null}
        role="alertdialog"
        title="Delete profile from this device?"
        description="Removes all observations, events, references, and drafts belonging to this synthetic profile permanently."
        onClose={() => setDeleteTargetId(null)}
        initialFocusRef={keepDeleteRef}
      >
        <UnretainedDraftNotice
          drafts={unretainedDrafts.filter((d) => d.profileId === deleteTargetId)}
          profileLabel={profiles.find((p) => p.profileId === deleteTargetId)?.label ?? 'Profile'}
          onExported={(f) => announce(`Download requested: ${f.join(', ')}. Check your Downloads.`)}
        />
        <div className="cs-row" style={{ justifyContent: 'flex-end', marginTop: '12px' }}>
          <button
            ref={keepDeleteRef}
            type="button"
            className="cs-btn cs-btn-primary"
            onClick={() => setDeleteTargetId(null)}
          >
            Keep profile
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-danger"
            onClick={async () => {
              if (deleteTargetId) {
                const target = deleteTargetId;
                setDeleteTargetId(null);
                await deleteProfile(target);
              }
            }}
          >
            Delete profile
          </button>
        </div>
      </Modal>
    </div>
  );
}
