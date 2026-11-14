import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ClipboardPlus } from 'lucide-react';
import {
  BODY_SYSTEM_DEFINITIONS,
  METRIC_DEFINITIONS,
  compareObservationToReference,
  deriveSevenDayFallbackReference,
  formatDurationHoursMinutes,
  formatObservationDisplay,
  getObservedMissionDay,
  resolveActiveReference,
  type BodySystemId,
  type MetricId,
  type ReferenceValue,
} from '../shared';
import { useAppState } from '../state/AppStateContext';
import { BodyDiagram } from '../components/BodyDiagram';
import { useTabList } from '../components/useTabList';

export function ExplorerPage() {
  const {
    activeProfile,
    profileObservations,
    profileReferences,
    latestByMetric,
    preferences,
    createReferenceVersion,
  } = useAppState();

  const [selectedSystem, setSelectedSystem] =
    useState<BodySystemId>('sleep_cognition');
  const [editingRefMetric, setEditingRefMetric] =
    useState<Exclude<MetricId, 'mood'> | null>(null);
  const [refInputPrimary, setRefInputPrimary] = useState('');
  const [refInputSecondary, setRefInputSecondary] = useState('');
  const [refMethod, setRefMethod] = useState('');
  const [refContext, setRefContext] = useState('');
  const [refError, setRefError] = useState<string | null>(null);

  const selectedDef = useMemo(
    () =>
      BODY_SYSTEM_DEFINITIONS.find((b) => b.id === selectedSystem) ??
      BODY_SYSTEM_DEFINITIONS[0]!,
    [selectedSystem],
  );

  const startEditingReference = (metricId: Exclude<MetricId, 'mood'>) => {
    const def = METRIC_DEFINITIONS[metricId];
    setEditingRefMetric(metricId);
    setRefInputPrimary('');
    setRefInputSecondary('');
    setRefMethod(def.methodOptions[0] ?? 'Not specified');
    setRefContext(def.contextOptions[0] ?? 'At rest');
    setRefError(null);
  };

  const handleSaveReferenceVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRefMetric) return;
    setRefError(null);

    if (refMethod === 'Not specified' || refContext === 'Not specified') {
      setRefError('Choose a specific method and context to anchor a personal reference.');
      return;
    }

    let value: ReferenceValue;
    let unit = METRIC_DEFINITIONS[editingRefMetric].canonicalUnit;

    if (editingRefMetric === 'blood_pressure') {
      const sys = Number(refInputPrimary);
      const dia = Number(refInputSecondary);
      if (!Number.isFinite(sys) || !Number.isFinite(dia) || sys <= dia) {
        setRefError('Enter valid systolic > diastolic numbers in mmHg.');
        return;
      }
      value = { kind: 'blood_pressure', systolic: sys, diastolic: dia };
      unit = 'mmHg';
    } else if (editingRefMetric === 'sleep') {
      const hrs = Number(refInputPrimary);
      if (!Number.isFinite(hrs) || hrs <= 0) {
        setRefError('Enter positive sleep reference hours (e.g. 7.4 for 7h 24m).');
        return;
      }
      value = { kind: 'sleep_duration', durationMinutes: Math.round(hrs * 60) };
      unit = 'min';
    } else {
      const val = Number(refInputPrimary);
      if (!Number.isFinite(val) || val <= 0) {
        setRefError('Enter a valid positive reference value.');
        return;
      }
      value = { kind: 'scalar', value: val };
    }

    await createReferenceVersion({
      metricId: editingRefMetric,
      provenance: 'user_updated',
      method: refMethod,
      context: refContext,
      unit,
      value,
    });
    setEditingRefMetric(null);
  };

  const systemTabs = useTabList({
    ids: BODY_SYSTEM_DEFINITIONS.map((b) => b.id),
    selected: selectedSystem,
    onSelect: setSelectedSystem,
    idPrefix: 'explorer-system',
  });

  return (
    <div className="cs-stack" style={{ gap: '20px' }}>
      <header className="cs-page-header" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">5 Body Systems · Coverage &amp; Personal References</span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Explorer
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Inspect what CrewSignal currently logs per physiological system and where coverage explicitly stops.
          </p>
        </div>

        <Link to="/demo/check-in" className="cs-btn cs-btn-primary">
          <ClipboardPlus size={16} aria-hidden="true" />
          <span>Start check-in</span>
        </Link>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          gap: '18px',
          alignItems: 'start',
        }}
      >
        <BodyDiagram
          selectedSystem={selectedSystem}
          onSelectSystem={setSelectedSystem}
          hasImmuneObservation={Boolean(latestByMetric.body_temperature)}
          hasNutritionObservation={Boolean(latestByMetric.blood_glucose)}
        />

        {/* Synchronized System Selector & Detail Panel */}
        <section className="cs-stack" aria-label="Body system details">
          <div className="cs-card cs-stack" style={{ gap: '12px' }}>
            <div className="cs-row" role="tablist" aria-label="All five body systems">
              {BODY_SYSTEM_DEFINITIONS.map((sys) => {
                const active = sys.id === selectedSystem;
                return (
                  <button
                    key={sys.id}
                    type="button"
                    {...systemTabs.getTabProps(sys.id)}
                    className={
                      active
                        ? 'cs-btn cs-btn-primary cs-btn-wrap'
                        : 'cs-btn cs-btn-secondary cs-btn-wrap'
                    }
                  >
                    {sys.name}
                  </button>
                );
              })}
            </div>

            <div {...systemTabs.panelProps} className="cs-stack" style={{ gap: '12px' }}>
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
              <span className="cs-mono-stamp">
                {selectedDef.anchorType === 'whole_body'
                  ? 'Whole-body context (not an organ pin)'
                  : `Region anchor: ${selectedDef.anchorType}`}{' '}
                · {selectedDef.coverageLabel}
              </span>
              <h2 className="cs-section-title" style={{ marginTop: '4px' }}>
                {selectedDef.name}
              </h2>
              <p style={{ marginTop: '6px', color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
                {selectedDef.summary}
              </p>
            </div>

            <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
              <span className="cs-mono-stamp">Explicit coverage boundary</span>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {selectedDef.limitation}
              </p>
            </div>

            {selectedDef.metricIds.length === 0 ? (
              <div className="cs-card-muted">
                <strong>No indicators tracked in this prototype</strong>
                <p className="cs-helper" style={{ marginTop: '4px' }}>
                  Musculoskeletal metrics require dedicated load/bone/countermeasure instruments not modeled in CrewSignal.
                </p>
              </div>
            ) : (
              <div className="cs-stack" style={{ gap: '12px' }}>
                {selectedDef.metricIds.map((mId) => {
                  const def = METRIC_DEFINITIONS[mId];
                  const obs = latestByMetric[mId];
                  const activeRef =
                    mId === 'mood'
                      ? null
                      : resolveActiveReference({
                          profileId: activeProfile?.profileId ?? '',
                          metricId: mId,
                          references: profileReferences,
                          observations: profileObservations,
                          nowUtc: activeProfile?.snapshotUtc ?? new Date().toISOString(),
                        });
                  const cmp = obs
                    ? compareObservationToReference(obs, activeRef)
                    : null;

                  const fallbackCandidate =
                    mId !== 'mood' && !activeRef && obs
                      ? deriveSevenDayFallbackReference({
                          profileId: activeProfile?.profileId ?? '',
                          metricId: mId,
                          method: obs.method,
                          context: obs.context,
                          observations: profileObservations,
                          createdAtUtc: activeProfile?.snapshotUtc ?? new Date().toISOString(),
                        })
                      : null;

                  return (
                    <article
                      key={mId}
                      className="cs-card-muted cs-stack"
                      style={{ gap: '8px' }}
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
                        <strong>{def.name}</strong>
                        <span className="cs-pill">
                          {obs
                            ? `Day ${getObservedMissionDay(obs)}`
                            : 'Not logged'}
                        </span>
                      </div>

                      {obs ? (
                        <>
                          <div className="cs-mono-value" style={{ fontSize: '1.25rem', fontWeight: 590 }}>
                            {formatObservationDisplay(obs, preferences.displayUnits).primaryText}
                          </div>
                          <div className="cs-helper">
                            Method: {obs.method} · Context: {obs.context}
                          </div>
                        </>
                      ) : (
                        <div className="cs-helper">
                          Not yet logged in check-in.
                        </div>
                      )}

                      <div
                        style={{
                          paddingTop: '8px',
                          borderTop: '1px solid var(--border-subtle)',
                          fontSize: '0.875rem',
                        }}
                      >
                        <div className="cs-row" style={{ gap: '6px' }}>
                          {cmp?.comparisonAvailable ? (
                            <CheckCircle2 size={15} aria-hidden="true" />
                          ) : (
                            <AlertCircle size={15} aria-hidden="true" />
                          )}
                          <strong>
                            {cmp?.comparisonAvailable
                              ? cmp.differenceText
                              : mId === 'mood'
                                ? 'Ordinal self-report scale (no numeric baseline)'
                                : 'Comparison unavailable'}
                          </strong>
                        </div>
                        {activeRef && (
                          <div className="cs-helper" style={{ marginTop: '4px' }}>
                            Active reference ({activeRef.label}):{' '}
                            <span className="cs-mono-value">
                              {activeRef.value?.kind === 'sleep_duration'
                                ? formatDurationHoursMinutes(
                                    activeRef.value.durationMinutes,
                                  )
                                : activeRef.value?.kind === 'blood_pressure'
                                  ? `${activeRef.value.systolic}/${activeRef.value.diastolic} mmHg`
                                  : activeRef.value?.kind === 'scalar'
                                    ? `${activeRef.value.value} ${activeRef.unit}`
                                    : 'Unavailable'}
                            </span>
                            {' · '}
                            {activeRef.method} ({activeRef.context})
                          </div>
                        )}
                        {!activeRef && mId !== 'mood' && (
                          <div className="cs-helper" style={{ marginTop: '4px' }}>
                            {fallbackCandidate?.unavailableReason ??
                              cmp?.unavailableReason ??
                              'Enter a personal reference or log 7 distinct days with compatible method & context.'}
                          </div>
                        )}
                      </div>

                      <div className="cs-row" style={{ gap: '8px' }}>
                        <Link
                          to={`/demo/check-in?metric=${mId}`}
                          className="cs-btn cs-btn-secondary"
                        >
                          Log {def.shortLabel.toLowerCase()}
                        </Link>
                        {mId !== 'mood' && (
                          <button
                            type="button"
                            className="cs-btn cs-btn-ghost"
                            onClick={() => startEditingReference(mId)}
                          >
                            Update personal reference
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            </div>
          </div>

          {editingRefMetric && (
            <form
              onSubmit={handleSaveReferenceVersion}
              className="cs-card cs-stack"
              aria-labelledby="edit-ref-heading"
            >
              <span className="cs-mono-stamp">Create new locked reference version</span>
              <h3 id="edit-ref-heading" className="cs-section-title">
                {METRIC_DEFINITIONS[editingRefMetric].name}
              </h3>
              <p className="cs-helper">
                Saving creates a newer version while keeping previous reference versions marked superseded—prior records are never rewritten.
              </p>

              {refError && (
                <div className="cs-banner cs-banner-error" role="alert">
                  {refError}
                </div>
              )}

              <div className="cs-grid-2">
                <div>
                  <label htmlFor="ref-primary" className="cs-label">
                    {editingRefMetric === 'blood_pressure'
                      ? 'Systolic (mmHg)'
                      : editingRefMetric === 'sleep'
                        ? 'Duration (hours, e.g. 7.4)'
                        : `Value (${METRIC_DEFINITIONS[editingRefMetric].canonicalUnit})`}
                  </label>
                  <input
                    id="ref-primary"
                    type="text"
                    inputMode="decimal"
                    className="cs-input cs-mono-value"
                    value={refInputPrimary}
                    onChange={(e) => setRefInputPrimary(e.target.value)}
                  />
                </div>
                {editingRefMetric === 'blood_pressure' && (
                  <div>
                    <label htmlFor="ref-secondary" className="cs-label">
                      Diastolic (mmHg)
                    </label>
                    <input
                      id="ref-secondary"
                      type="text"
                      inputMode="decimal"
                      className="cs-input cs-mono-value"
                      value={refInputSecondary}
                      onChange={(e) => setRefInputSecondary(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="cs-grid-2">
                <div>
                  <label htmlFor="ref-method" className="cs-label">
                    Reference method
                  </label>
                  <select
                    id="ref-method"
                    className="cs-select"
                    value={refMethod}
                    onChange={(e) => setRefMethod(e.target.value)}
                  >
                    {METRIC_DEFINITIONS[editingRefMetric].methodOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ref-context" className="cs-label">
                    Reference context
                  </label>
                  <select
                    id="ref-context"
                    className="cs-select"
                    value={refContext}
                    onChange={(e) => setRefContext(e.target.value)}
                  >
                    {METRIC_DEFINITIONS[editingRefMetric].contextOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="cs-row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={() => setEditingRefMetric(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="cs-btn cs-btn-primary">
                  Save reference version
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
