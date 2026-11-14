import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardPlus } from 'lucide-react';
import {
  METRIC_DEFINITIONS,
  METRIC_ORDER,
  compareObservationToReference,
  formatObservationDisplay,
  formatUtcTimeHHMM,
  getObservationSortTimestampMs,
  getObservedMissionDay,
  getReadingStatus,
  resolveActiveReference,
  type MetricId,
} from '../shared';
import { useAppState } from '../state/AppStateContext';
import { SleepChart } from '../components/SleepChart';
import { ReadingStatusBadge } from '../components/ReadingStatusBadge';

export function TrendsPage() {
  const {
    activeProfile,
    currentMissionDay,
    profileObservations,
    profileReferences,
    latestByMetric,
    scheduleStatusByMetric,
    preferences,
  } = useAppState();

  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const [filterMetric, setFilterMetric] = useState<'all' | MetricId>('all');

  const sleepRef = useMemo(
    () =>
      resolveActiveReference({
        profileId: activeProfile?.profileId ?? '',
        metricId: 'sleep',
        references: profileReferences,
        observations: profileObservations,
        nowUtc: activeProfile?.snapshotUtc ?? new Date().toISOString(),
      }),
    [activeProfile, profileReferences, profileObservations],
  );

  const sortedObservations = useMemo(() => {
    const filtered =
      filterMetric === 'all'
        ? profileObservations
        : profileObservations.filter((o) => o.metricId === filterMetric);
    return [...filtered].sort(
      (a, b) => getObservationSortTimestampMs(b) - getObservationSortTimestampMs(a),
    );
  }, [profileObservations, filterMetric]);

  const latestSleep = latestByMetric.sleep;
  const sleepComparison = latestSleep ? compareObservationToReference(latestSleep, sleepRef) : null;
  const filteredLatest = filterMetric === 'all' ? null : latestByMetric[filterMetric];
  const filteredReference = filterMetric === 'all' ? null : resolveActiveReference({
    profileId: activeProfile?.profileId ?? '',
    metricId: filterMetric,
    references: profileReferences,
    observations: profileObservations,
    nowUtc: activeProfile?.snapshotUtc ?? new Date().toISOString(),
  });
  const filteredComparison = filteredLatest ? compareObservationToReference(filteredLatest, filteredReference) : null;

  return (
    <div className="cs-stack" style={{ gap: '20px' }}>
      <header className="cs-page-header" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">
            {activeProfile?.alias ?? activeProfile?.label} · Long-horizon sleep &amp; log history
          </span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Trends
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Sparse axis ticks prevent clutter; gaps remain blank so unlogged days never display as zero.
          </p>
        </div>

        <Link to="/demo/check-in" className="cs-btn cs-btn-primary">
          <ClipboardPlus size={16} aria-hidden="true" />
          <span>Record entry</span>
        </Link>
      </header>

      <section className="cs-card cs-stack" aria-labelledby="sleep-trend-heading">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <h2 id="sleep-trend-heading" className="cs-section-title">
              Sleep duration trend
            </h2>
            <div className="cs-row">
              <span className="cs-helper">Latest reading</span>
              <ReadingStatusBadge status={getReadingStatus(latestSleep, sleepComparison, scheduleStatusByMetric.sleep)} />
            </div>
            <p className="cs-helper">
              Main sleep observations compared against active personal reference (7h 24m for SIM-01).
            </p>
          </div>

          <div
            role="group"
            aria-label="Trend window range"
            className="cs-row"
            style={{ gap: '6px' }}
          >
            <button
              type="button"
              className={range === '7d' ? 'cs-btn cs-btn-primary' : 'cs-btn cs-btn-secondary'}
              aria-pressed={range === '7d'}
              onClick={() => setRange('7d')}
            >
              7-day
            </button>
            <button
              type="button"
              className={range === '30d' ? 'cs-btn cs-btn-primary' : 'cs-btn cs-btn-secondary'}
              aria-pressed={range === '30d'}
              onClick={() => setRange('30d')}
            >
              30-day
            </button>
          </div>
        </div>

        <SleepChart
          observations={profileObservations}
          sleepReference={sleepRef}
          range={range}
          currentMissionDay={currentMissionDay}
          allowTableToggle
        />
      </section>

      <section className="cs-card cs-stack" aria-labelledby="obs-log-heading">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <h2 id="obs-log-heading" className="cs-section-title">
              Observation log ({sortedObservations.length})
            </h2>
            {filterMetric !== 'all' && (
              <div className="cs-row">
                <span className="cs-helper">Latest {METRIC_DEFINITIONS[filterMetric].shortLabel.toLowerCase()} reading</span>
                <ReadingStatusBadge status={getReadingStatus(filteredLatest, filteredComparison, scheduleStatusByMetric[filterMetric])} />
              </div>
            )}
            <p className="cs-helper">
              Displays both entered values and canonical conversions matching your display units.
            </p>
          </div>

          <div className="cs-row" style={{ gap: '8px' }}>
            <label htmlFor="trends-metric-filter" className="sr-only">
              Filter observation log by metric
            </label>
            <select
              id="trends-metric-filter"
              className="cs-select"
              style={{ width: 'auto' }}
              value={filterMetric}
              onChange={(e) => setFilterMetric(e.target.value as 'all' | MetricId)}
            >
              <option value="all">All indicators ({profileObservations.length})</option>
              {METRIC_ORDER.map((mId) => (
                <option key={mId} value={mId}>
                  {METRIC_DEFINITIONS[mId].shortLabel}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sortedObservations.length === 0 ? (
          <div className="cs-card-muted">
            <p style={{ fontWeight: 500 }}>No observations recorded for this filter</p>
            <p className="cs-helper" style={{ marginTop: '4px' }}>
              Log a new observation in Check-in or adjust the indicator filter above.
            </p>
          </div>
        ) : (
          <div className="cs-table-wrap" tabIndex={0} role="region" aria-label="Filtered observation log table">
            <table className="cs-table">
              <thead>
                <tr>
                  <th scope="col">Day &amp; Time</th>
                  <th scope="col">Indicator</th>
                  <th scope="col">Reading</th>
                  <th scope="col">Method &amp; Context</th>
                  <th scope="col">Reference comparison</th>
                </tr>
              </thead>
              <tbody>
                {sortedObservations.map((obs) => {
                  const formatted = formatObservationDisplay(
                    obs,
                    preferences.displayUnits,
                  );
                  const activeRef =
                    obs.metricId === 'mood'
                      ? null
                      : resolveActiveReference({
                          profileId: obs.profileId,
                          metricId: obs.metricId,
                          references: profileReferences,
                          observations: profileObservations,
                          nowUtc: obs.recordedAtUtc,
                        });
                  const cmp = compareObservationToReference(obs, activeRef);
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
                      <td>
                        <strong>{METRIC_DEFINITIONS[obs.metricId].shortLabel}</strong>
                        {obs.correctionHistory.length > 0 && (
                          <div className="cs-helper">
                            Corrected ({obs.correctionHistory.length})
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="cs-mono-value" style={{ fontWeight: 500 }}>
                          {formatted.primaryText}
                        </div>
                        {formatted.isConvertedDisplay && (
                          <div className="cs-helper">Entered: {formatted.enteredText}</div>
                        )}
                      </td>
                      <td>
                        <div>{obs.method}</div>
                        <div className="cs-helper">{obs.context}</div>
                      </td>
                      <td>
                        {cmp.comparisonAvailable && cmp.differenceText
                          ? cmp.differenceText
                          : cmp.unavailableReason ?? 'Comparison unavailable'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
