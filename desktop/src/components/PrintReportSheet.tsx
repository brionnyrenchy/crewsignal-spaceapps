import {
  formatObservationDisplay,
  getObservedMissionDay,
  METRIC_DEFINITIONS,
  type AppPreferences,
  type ReportBundle,
} from "../shared/src";

interface PrintReportSheetProps {
  report: ReportBundle;
  displayUnits: AppPreferences["displayUnits"];
}

export function PrintReportSheet({ report, displayUnits }: PrintReportSheetProps) {
  const excludedNames = report.excludedMetricIds.map(
    (m) => METRIC_DEFINITIONS[m].shortLabel,
  );
  const includedNames = report.includedMetricIds.map(
    (m) => METRIC_DEFINITIONS[m].shortLabel,
  );

  return (
    <section className="print-only-container" aria-hidden="true">
      <div className="print-report-sheet">
        <h1>CrewSignal Health Record Export</h1>
        <p className="print-subtitle">
          Filtered observation summary for handoff · Not a medical record or clearance
        </p>

        <div className="print-meta-grid">
          <strong>Profile</strong>
          <span>
            {report.profileLabel} ({report.mode === "demo" ? "Demo · Synthetic data" : "Personal · Local log"})
          </span>
          <strong>Mission</strong>
          <span>
            {report.missionName} · Epoch {report.missionEpochUtc}
          </span>
          <strong>Day range</strong>
          <span>
            Days {report.missionDayRange.startDay}–{report.missionDayRange.endDay} ({report.totalObservations} observations across {report.includedTypesCount} types)
          </span>
          <strong>Generated</strong>
          <span>{report.generatedAtUtc}</span>
        </div>

        <div className="print-scope-block">
          <div>
            <strong>Included types:</strong> {includedNames.join(", ") || "None"}
          </div>
          <div>
            <strong>Excluded types:</strong> {excludedNames.join(", ") || "None"}
          </div>
          <div>
            <strong>Private notes:</strong>{" "}
            {report.includeNotes ? "Included by explicit user choice" : "Excluded"}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Time / Period</th>
              <th>Measurement</th>
              <th>Value (display)</th>
              <th>Entered / Source</th>
              <th>Method & Context</th>
              {report.includeNotes ? <th>Note</th> : null}
            </tr>
          </thead>
          <tbody>
            {report.observations.map((obs) => {
              const display = formatObservationDisplay(obs, displayUnits);
              const day = getObservedMissionDay(obs);
              const timeStr =
                obs.timing.kind === "instant"
                  ? obs.timing.missionTimeLabel
                  : `${obs.timing.sleepType.replace("_", " ")} (end Day ${obs.timing.endingMissionDay})`;
              return (
                <tr key={obs.observationId}>
                  <td>Day {day}</td>
                  <td>{timeStr}</td>
                  <td>{METRIC_DEFINITIONS[obs.metricId].shortLabel}</td>
                  <td>{display.primaryText}</td>
                  <td>
                    {display.isConvertedDisplay
                      ? `Entered ${display.enteredText} (${obs.provenance})`
                      : obs.provenance}
                  </td>
                  <td>
                    {obs.method} · {obs.context}
                  </td>
                  {report.includeNotes ? <td>{obs.note ?? "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>

        {report.references.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <strong>Active references included</strong>
            <ul>
              {report.references.map((r) => (
                <li key={r.referenceId}>
                  {METRIC_DEFINITIONS[r.metricId].shortLabel} · {r.label} ({r.method}, {r.context})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {report.evidence.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <strong>Evidence citations (included types only)</strong>
            <ul>
              {report.evidence.map((e) => (
                <li key={e.sourceId}>
                  {e.title} ({e.summaryVersion}, checked {e.checkedDate}) — {e.url}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="print-footer">
          {report.disclaimers.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
