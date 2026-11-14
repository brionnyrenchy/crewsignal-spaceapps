import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Printer } from 'lucide-react';
import {
  DEFAULT_REPORT_METRICS,
  EVIDENCE_REGISTRY,
  METRIC_DEFINITIONS,
  METRIC_ORDER,
  buildReportBundle,
  formatObservationDisplay,
  formatUtcTimeHHMM,
  getObservedMissionDay,
  serializeObservationsToCsv,
  type MetricId,
} from '../shared';
import { useAppState } from '../state/AppStateContext';
import { downloadJsonBundle, downloadTextFile } from '../utils/files';

export function ReportsPage() {
  const {
    activeProfile,
    currentMissionDay,
    profileObservations,
    profileReferences,
    preferences,
    announce,
  } = useAppState();

  const [startDay, setStartDay] = useState(() => Math.max(1, currentMissionDay - 6));
  const [endDay, setEndDay] = useState(currentMissionDay);

  useEffect(() => {
    setStartDay(Math.max(1, currentMissionDay - 6));
    setEndDay(currentMissionDay);
  }, [activeProfile?.profileId, currentMissionDay]);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricId[]>([
    ...DEFAULT_REPORT_METRICS,
  ]);
  const [includeMood, setIncludeMood] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [downloadBanner, setDownloadBanner] = useState<{
    filename: string;
    byteLength: number;
  } | null>(null);

  const toggleMetric = (metricId: MetricId) => {
    setSelectedMetrics((prev) =>
      prev.includes(metricId)
        ? prev.filter((m) => m !== metricId)
        : [...prev, metricId],
    );
  };

  const reportBundle = useMemo(() => {
    if (!activeProfile) return null;
    return buildReportBundle({
      profile: activeProfile,
      observations: profileObservations,
      references: profileReferences,
      startDay: Math.min(startDay, endDay),
      endDay: Math.max(startDay, endDay),
      selectedMetricIds: includeMood
        ? [...new Set([...selectedMetrics, 'mood' as MetricId])]
        : selectedMetrics,
      includeMood,
      includeNotes,
      generatedAtUtc: activeProfile.snapshotUtc ?? new Date().toISOString(),
    });
  }, [
    activeProfile,
    profileObservations,
    profileReferences,
    startDay,
    endDay,
    selectedMetrics,
    includeMood,
    includeNotes,
  ]);

  const handleDownloadJson = () => {
    if (!reportBundle) return;
    const slug = activeProfile?.scenarioId?.toLowerCase() ?? 'demo';
    const res = downloadJsonBundle(
      `crewsignal-report-${slug}-d${startDay}-d${endDay}.json`,
      reportBundle,
    );
    setDownloadBanner({ filename: res.filename, byteLength: res.byteLength });
    announce(`Download requested for ${res.filename}. Check your Downloads.`);
  };

  const handleDownloadCsv = () => {
    if (!reportBundle) return;
    const csv = serializeObservationsToCsv(reportBundle.observations, {
      includeNotes,
    });
    const res = downloadTextFile(
      `crewsignal-report-d${startDay}-d${endDay}.csv`,
      csv,
      'text/csv;charset=utf-8',
    );
    setDownloadBanner({ filename: res.filename, byteLength: res.byteLength });
    announce(`Download requested for ${res.filename}. Check your Downloads.`);
  };

  return (
    <div className="cs-stack" style={{ gap: '20px' }}>
      <header className="cs-page-header no-print" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">Filtered Export &amp; A4 Light Print</span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Reports
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Filtered observation report ({reportBundle?.totalObservations ?? 0} observations across {reportBundle?.includedTypesCount ?? 0} types). Excludes mood and notes by default.
          </p>
        </div>

        <div className="cs-row">
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            disabled={!reportBundle}
            onClick={handleDownloadCsv}
          >
            <Download size={16} aria-hidden="true" />
            <span>Download CSV</span>
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => window.print()}
          >
            <Printer size={16} aria-hidden="true" />
            <span>Print A4 report</span>
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-primary"
            disabled={!reportBundle}
            onClick={handleDownloadJson}
          >
            <Download size={16} aria-hidden="true" />
            <span>Download report JSON</span>
          </button>
        </div>
      </header>

      {downloadBanner && (
        <div className="cs-banner cs-banner-saved no-print" role="status">
          <div className="cs-row" style={{ gap: '10px' }}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>
              <strong>Download requested</strong> · Check your Downloads (
              <span className="cs-mono-value">{downloadBanner.filename}</span>,{' '}
              <span className="cs-tabular">{downloadBanner.byteLength} bytes</span>)
            </div>
          </div>
          <button
            type="button"
            className="cs-btn cs-btn-ghost"
            onClick={() => setDownloadBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Selection Controls */}
      <section className="cs-card cs-stack no-print" aria-labelledby="report-selection-heading">
        <h2 id="report-selection-heading" className="cs-section-title">
          Report selection &amp; privacy filters
        </h2>

        <div className="cs-grid-2">
          <div>
            <label htmlFor="report-start-day" className="cs-label">
              Start mission day
            </label>
            <input
              id="report-start-day"
              type="number"
              min={1}
              className="cs-input cs-mono-value"
              value={startDay}
              onChange={(e) => setStartDay(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div>
            <label htmlFor="report-end-day" className="cs-label">
              End mission day
            </label>
            <input
              id="report-end-day"
              type="number"
              min={1}
              className="cs-input cs-mono-value"
              value={endDay}
              onChange={(e) => setEndDay(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>

        <div>
          <span className="cs-label">Included indicator types</span>
          <div className="cs-row" style={{ gap: '8px' }}>
            {METRIC_ORDER.filter((m) => m !== 'mood').map((mId) => {
              const checked = selectedMetrics.includes(mId);
              return (
                <label
                  key={mId}
                  className="cs-btn cs-btn-secondary cs-btn-wrap"
                  style={{ cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMetric(mId)}
                  />
                  <span>{METRIC_DEFINITIONS[mId].shortLabel}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="cs-row" style={{ gap: '16px' }}>
          <label className="cs-row" style={{ minHeight: '44px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeMood}
              onChange={(e) => setIncludeMood(e.target.checked)}
            />
            <span>Include mood self-report entries (off by default)</span>
          </label>

          <label className="cs-row" style={{ minHeight: '44px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(e) => setIncludeNotes(e.target.checked)}
            />
            <span>Include personal notes (off by default)</span>
          </label>
        </div>
      </section>

      {/* Printable & Preview Surface */}
      {reportBundle && (
        <section className="cs-card cs-stack" aria-labelledby="report-preview-heading">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              paddingBottom: '12px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <span className="cs-mono-stamp">
                CrewSignal Observation Report · {reportBundle.profileLabel} · Days{' '}
                {reportBundle.missionDayRange.startDay}–{reportBundle.missionDayRange.endDay}
              </span>
              <h2 id="report-preview-heading" className="cs-section-title" style={{ marginTop: '4px' }}>
                Report preview ({reportBundle.totalObservations} observations across{' '}
                {reportBundle.includedTypesCount} types)
              </h2>
              <p className="cs-helper" style={{ marginTop: '4px' }}>
                Total log entries for profile: {profileObservations.length} · Filtered report excludes full backups, events, and unselected fields.
              </p>
            </div>
            <div className="cs-stack" style={{ gap: '4px', alignItems: 'flex-end' }}>
              <span className="cs-pill">kind: {reportBundle.kind}</span>
              <span className="cs-helper">
                Mood: {reportBundle.includedMetricIds.includes('mood') ? 'Included' : 'Excluded'} · Notes:{' '}
                {reportBundle.includeNotes ? 'Included' : 'Excluded'}
              </span>
            </div>
          </div>

          <div className="cs-table-wrap" tabIndex={0} role="region" aria-label="Report preview observations table">
            <table className="cs-table">
              <thead>
                <tr>
                  <th scope="col">Day &amp; Time</th>
                  <th scope="col">Indicator</th>
                  <th scope="col">Entered &amp; Converted</th>
                  <th scope="col">Method &amp; Context</th>
                  {includeNotes && <th scope="col">Note</th>}
                </tr>
              </thead>
              <tbody>
                {reportBundle.observations.length === 0 ? (
                  <tr>
                    <td colSpan={includeNotes ? 5 : 4} className="cs-helper">
                      No matching observations inside Days {reportBundle.missionDayRange.startDay}–{reportBundle.missionDayRange.endDay} for the chosen filters.
                    </td>
                  </tr>
                ) : (
                  reportBundle.observations.map((obs) => {
                    const fmt = formatObservationDisplay(obs, preferences.displayUnits);
                    const day = getObservedMissionDay(obs);
                    const hhmm =
                      obs.timing.kind === 'instant'
                        ? formatUtcTimeHHMM(obs.timing.observedAtUtc)
                        : formatUtcTimeHHMM(obs.timing.reportedAtUtc);
                    return (
                      <tr key={obs.observationId}>
                        <td className="cs-mono-value">
                          Day {day} · {hhmm}
                        </td>
                        <td>{METRIC_DEFINITIONS[obs.metricId].shortLabel}</td>
                        <td>
                          <div className="cs-mono-value">{fmt.primaryText}</div>
                          {fmt.isConvertedDisplay && (
                            <div className="cs-helper">Entered: {fmt.enteredText}</div>
                          )}
                        </td>
                        <td>
                          {obs.method} · {obs.context}
                        </td>
                        {includeNotes && <td>{obs.note ?? '—'}</td>}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
            <span className="cs-mono-stamp">Included references &amp; disclosures</span>
            <p className="cs-helper">
              {reportBundle.disclaimers.join(' ')}
            </p>
            <p className="cs-helper">
              Citations included:{' '}
              {reportBundle.evidence
                .map((e) => EVIDENCE_REGISTRY[e.sourceId]?.shortTitle ?? e.title)
                .join(' · ') || 'None'}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
