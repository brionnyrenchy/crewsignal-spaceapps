import {
  ACTION_CONTENT_LIST,
  buildSleepInsight,
  EVIDENCE_REGISTRY,
  getLatestObservationsByMetric,
} from "../shared/src";
import { desktopBridge } from "../bridge/desktopBridge";
import { useApp } from "../state/AppContext";

export function ActionsRoute() {
  const {
    snapshot,
    activeProfile,
    currentReferenceNowUtc,
    activeReferencesByMetric,
    refreshSnapshot,
    showToast,
    navigate,
  } = useApp();

  if (!snapshot || !activeProfile) {
    return (
      <div className="panel-card">
        <p style={{ margin: 0 }}>Loading actions…</p>
      </div>
    );
  }

  const latestByMetric = getLatestObservationsByMetric(snapshot.profileData.observations);
  const latestSleep = latestByMetric.sleep;
  const sleepRef = activeReferencesByMetric.sleep;
  const sleepInsight = latestSleep
    ? buildSleepInsight({
        observation: latestSleep,
        reference: sleepRef,
        createdAtUtc: currentReferenceNowUtc,
      })
    : null;

  const isSleepReviewed = Boolean(
    sleepInsight &&
      snapshot.profileData.actionReviews.find(
        (r) =>
          r.actionId === "action-review-sleep-routine" &&
          r.observationId === sleepInsight.observationId &&
          r.referenceVersion === sleepInsight.referenceVersion &&
          r.ruleVersion === sleepInsight.ruleVersion &&
          r.sourceVersion === (sleepInsight.sourceVersions["nasa-sleep-risk"] ?? "Version 1") &&
          r.reviewed,
      ),
  );

  const handleMarkReviewed = async () => {
    if (!sleepInsight) return;
    const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    await desktopBridge.recordActionReview(activeProfile.profileId, {
      reviewId: `rev-${sleepInsight.insightId}`,
      actionId: "action-review-sleep-routine",
      observationId: sleepInsight.observationId,
      referenceVersion: sleepInsight.referenceVersion,
      ruleVersion: sleepInsight.ruleVersion,
      sourceVersion: sleepInsight.sourceVersions["nasa-sleep-risk"] ?? "Version 1",
      reviewedAtUtc: nowIso,
      reviewed: true,
    });
    await refreshSnapshot(activeProfile.profileId);
    showToast({
      tone: "success",
      title: "Action marked reviewed",
      detail: `Tied to Reference v${sleepInsight.referenceVersion ?? "—"} · ${sleepInsight.ruleVersion}. Observations unchanged.`,
    });
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Actions</h1>
          <p className="page-subtitle">
            Conservative educational review steps tied to explicit rule, reference, and cached source versions.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate("sources")}>
          Open Sources & Evidence
        </button>
      </div>

      <div className="stack-md">
        {ACTION_CONTENT_LIST.map((action) => {
          const isSleepAction = action.actionId === "action-review-sleep-routine";
          const relatedEvidence = action.sourceIds
            .map((id) => EVIDENCE_REGISTRY[id])
            .filter((e): e is NonNullable<typeof e> => Boolean(e));

          return (
            <section
              key={action.actionId}
              className="panel-card stack-md"
              aria-labelledby={`action-${action.actionId}`}
            >
              <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                <div>
                  <h2 id={`action-${action.actionId}`} className="panel-heading">
                    {action.title}
                  </h2>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-supporting)" }}>
                    {action.triggerSummary}
                  </p>
                </div>
                <div className="row-wrap">
                  {isSleepAction && isSleepReviewed ? (
                    <span className="badge-success">Reviewed (current version)</span>
                  ) : null}
                  <span className={action.enabled ? "badge-neutral" : "badge-review"}>
                    {action.badgeLabel}
                  </span>
                </div>
              </div>

              {!action.enabled && action.disabledReason ? (
                <div className="notice-banner" role="status">
                  <div>
                    <strong>Disabled by safety gate:</strong> {action.disabledReason}
                  </div>
                </div>
              ) : (
                <>
                  {isSleepAction && sleepInsight ? (
                    <div className="notice-banner" style={{ padding: "12px 14px" }}>
                      <div className="stack-sm">
                        <strong>Current observation context: {sleepInsight.summary}</strong>
                        <span style={{ fontSize: 13, color: "var(--text-supporting)" }}>
                          Reference version: {sleepInsight.referenceVersion ?? "Unavailable"} · Rule: {action.ruleVersion} · Source: {action.sourceVersion}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text-body)" }}>
                    {action.steps.map((step) => (
                      <li key={step} style={{ marginBottom: 4 }}>
                        {step}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div style={{ fontSize: 13, color: "var(--text-supporting)" }}>
                <strong>Scope limitation:</strong> {action.limitation}
              </div>

              <div className="row-wrap" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border-hairline)", paddingTop: 12 }}>
                <div className="row-wrap" style={{ fontSize: 12, color: "var(--text-supporting)" }}>
                  <span className="mono-label">
                    Rule {action.ruleVersion} · {action.sourceVersion}
                  </span>
                  {relatedEvidence.map((ev) => (
                    <button
                      key={ev.sourceId}
                      type="button"
                      className="btn-link"
                      style={{ fontSize: 12 }}
                      onClick={() => navigate("sources")}
                    >
                      {ev.shortTitle}
                    </button>
                  ))}
                </div>

                {isSleepAction && sleepInsight ? (
                  <button
                    type="button"
                    className={isSleepReviewed ? "btn-secondary" : "btn-primary"}
                    disabled={isSleepReviewed}
                    onClick={() => void handleMarkReviewed()}
                  >
                    {isSleepReviewed ? "Reviewed for current version" : "Mark reviewed"}
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
