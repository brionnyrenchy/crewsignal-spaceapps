import {
  compareObservationToReference,
  computeMissionDay,
  formatObservationDisplay,
  getObservationSortTimestampMs,
  getObservedMissionDay,
  METRIC_DEFINITIONS,
  METRIC_ORDER,
} from "../shared/src";
import { TrendChart } from "../components/TrendChart";
import { useApp } from "../state/AppContext";

export function TrendsRoute() {
  const {
    snapshot,
    activeProfile,
    preferences,
    selectedTrendMetric,
    setSelectedTrendMetric,
    trendRangeDays,
    setTrendRangeDays,
    trendViewMode,
    setTrendViewMode,
    activeReferencesByMetric,
    currentReferenceNowUtc,
    openDraftForMetric,
    navigate,
  } = useApp();

  if (!snapshot || !activeProfile) {
    return (
      <div className="panel-card">
        <p style={{ margin: 0 }}>Loading trends…</p>
      </div>
    );
  }

  const missionDay = Math.max(
    1,
    computeMissionDay(currentReferenceNowUtc, activeProfile.missionEpochUtc),
  );
  const observations = snapshot.profileData.observations
    .filter((o) => o.metricId === selectedTrendMetric)
    .sort((a, b) => getObservationSortTimestampMs(b) - getObservationSortTimestampMs(a));

  const def = METRIC_DEFINITIONS[selectedTrendMetric];
  const activeRef = activeReferencesByMetric[selectedTrendMetric];

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Trends</h1>
          <p className="page-subtitle">
            Plot committed readings honestly across 7 or 30 days, preserving entered units and leaving unrecorded days empty.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void openDraftForMetric(selectedTrendMetric)}
        >
          Record {def.shortLabel.toLowerCase()}
        </button>
      </div>

      {/* Metric tabs */}
      <div className="chip-group" role="group" aria-label="Select trend measurement">
        {METRIC_ORDER.map((mId) => (
          <button
            key={mId}
            type="button"
            className="chip-btn"
            aria-pressed={selectedTrendMetric === mId}
            onClick={() => setSelectedTrendMetric(mId)}
          >
            {METRIC_DEFINITIONS[mId].shortLabel}
          </button>
        ))}
      </div>

      <section className="panel-card stack-md" aria-labelledby="trend-panel-heading">
        <div className="panel-header-row">
          <div>
            <h2 id="trend-panel-heading" className="panel-heading">
              {def.name}
            </h2>
            <span className="mono-label">
              {observations.length === 0
                ? "Not recorded"
                : `${observations.length} total recorded observation(s)`}
            </span>
          </div>

          <div className="row-wrap">
            <div className="segmented-group" role="group" aria-label="Window length">
              <button
                type="button"
                className="segmented-btn"
                aria-pressed={trendRangeDays === 7}
                onClick={() => setTrendRangeDays(7)}
              >
                Last 7 days
              </button>
              <button
                type="button"
                className="segmented-btn"
                aria-pressed={trendRangeDays === 30}
                onClick={() => setTrendRangeDays(30)}
              >
                Last 30 days
              </button>
            </div>

            <div className="segmented-group" role="group" aria-label="Display format">
              <button
                type="button"
                className="segmented-btn"
                aria-pressed={trendViewMode === "chart"}
                onClick={() => setTrendViewMode("chart")}
              >
                Chart
              </button>
              <button
                type="button"
                className="segmented-btn"
                aria-pressed={trendViewMode === "table"}
                onClick={() => setTrendViewMode("table")}
              >
                Data table
              </button>
            </div>
          </div>
        </div>

        {trendViewMode === "chart" ? (
          <TrendChart
            metricId={selectedTrendMetric}
            observations={snapshot.profileData.observations}
            reference={activeRef}
            rangeDays={trendRangeDays}
            currentMissionDay={missionDay}
            displayUnits={preferences.displayUnits}
          />
        ) : (
          <div
            className="data-table-wrap"
            role="region"
            aria-label="Trend observations data table"
            tabIndex={0}
          >
            {observations.length === 0 ? (
              <p style={{ margin: 0, color: "var(--text-supporting)" }}>
                Not recorded yet.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Time / Period</th>
                    <th>Displayed</th>
                    <th>Entered</th>
                    <th>Method & context</th>
                    <th>Comparison</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((obs) => {
                    const disp = formatObservationDisplay(obs, preferences.displayUnits);
                    const cmp = compareObservationToReference(obs, activeRef);
                    const day = getObservedMissionDay(obs);
                    const timeStr =
                      obs.timing.kind === "instant"
                        ? `${obs.timing.missionTimeLabel} UTC`
                        : `${obs.timing.sleepType.replace("_", " ")} (end Day ${obs.timing.endingMissionDay})`;
                    return (
                      <tr key={obs.observationId}>
                        <td className="tabular-value">Day {day}</td>
                        <td>{timeStr}</td>
                        <td className="tabular-value" style={{ fontWeight: 590 }}>
                          {disp.primaryText}
                        </td>
                        <td className="tabular-value">{disp.enteredText}</td>
                        <td>
                          {obs.method} · {obs.context}
                        </td>
                        <td style={{ fontSize: 13, color: "var(--text-supporting)" }}>
                          {cmp.comparisonAvailable
                            ? cmp.differenceText
                            : cmp.unavailableReason}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* Reference Provenance Panel */}
      <section className="panel-card stack-sm" aria-labelledby="trend-ref-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="trend-ref-heading" className="panel-heading">
            Reference provenance
          </h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate("settings")}
          >
            Manage references in Settings
          </button>
        </div>

        {selectedTrendMetric === "mood" ? (
          <p style={{ margin: 0, color: "var(--text-body)" }}>
            Mood uses discrete ordinal history (1–5 CrewSignal custom scale v1) rather than a numeric reference baseline.
          </p>
        ) : activeRef && activeRef.status === "active" && activeRef.value ? (
          <div style={{ color: "var(--text-body)", fontSize: 14 }}>
            <strong>{activeRef.label}</strong> · Method: {activeRef.method} · Context:{" "}
            {activeRef.context} ({activeRef.provenance.replace(/_/g, " ")})
          </div>
        ) : (
          <div style={{ color: "var(--text-supporting)", fontSize: 14 }}>
            Comparison unavailable — enter a personal reference or log 7 distinct days with a compatible known method and context in Settings.
          </div>
        )}
      </section>
    </div>
  );
}
