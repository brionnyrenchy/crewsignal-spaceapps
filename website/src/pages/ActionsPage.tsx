import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, CheckCircle2, Lock } from 'lucide-react';
import {
  ACTION_CONTENT_LIST,
  EVIDENCE_REGISTRY,
  buildMetricInsight,
  METRIC_ACTION_IDS,
  METRIC_ORDER,
  type Insight,
  findCurrentInsightReview,
  resolveActiveReference,
} from '../shared';
import { useAppState } from '../state/AppStateContext';

export function ActionsPage() {
  const {
    activeProfile,
    profileObservations,
    profileReferences,
    profileInsights,
    latestByMetric,
    acknowledgeInsight,
  } = useAppState();

  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.focus();
  }, [hash]);

  const insightsByAction = new Map<string, Insight>();
  const currentUtc = activeProfile?.snapshotUtc ?? new Date().toISOString();
  if (activeProfile) {
    for (const metricId of METRIC_ORDER) {
      const observation = latestByMetric[metricId];
      if (!observation) continue;
      const insight = buildMetricInsight(metricId, {
        observation,
        reference: resolveActiveReference({
          profileId: activeProfile.profileId,
          metricId,
          observations: profileObservations,
          references: profileReferences,
          nowUtc: currentUtc,
        }),
        createdAtUtc: currentUtc,
      });
      if (insight) insightsByAction.set(METRIC_ACTION_IDS[metricId], insight);
    }
  }

  return (
    <div className="cs-stack" style={{ gap: '20px' }}>
      <header className="cs-page-header" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">Educational &amp; Data Quality Guidance</span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Actions
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Educational review steps paired with exact applicability boundaries. Never prescribes clinical treatment or clears duty fitness.
          </p>
        </div>
      </header>

      <div className="cs-stack" style={{ gap: '16px' }}>
        {ACTION_CONTENT_LIST.map((action) => {
          const insight = insightsByAction.get(action.actionId);
          const reviewed = findCurrentInsightReview(profileInsights, insight ?? null);
          return (
            <article key={action.actionId} className="cs-card cs-stack" style={{ gap: '12px' }}>
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
                  <span className="cs-mono-stamp">
                    {action.ruleId} · {action.ruleVersion}
                  </span>
                  <h2 id={action.actionId} tabIndex={-1} className="cs-section-title" style={{ marginTop: '4px' }}>
                    {action.title}
                  </h2>
                </div>
                <span className="cs-pill">
                  {!action.enabled && <Lock size={13} aria-hidden="true" />}
                  <span>{action.badgeLabel}</span>
                </span>
              </div>

              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
                {action.enabled ? action.triggerSummary : action.disabledReason}
              </p>

              {insight && (
                <div className="cs-card-muted cs-stack">
                  <strong>{insight.summary}</strong>
                  <p className="cs-helper">
                    Reading {insight.observationId} · Reference {insight.referenceId} (v{insight.referenceVersion})
                  </p>
                  {reviewed ? (
                    <span className="cs-pill cs-pill-saved">
                      <CheckCircle2 size={14} aria-hidden="true" />
                      <span>Reviewed for current version · {reviewed.reviewedAtUtc}</span>
                    </span>
                  ) : (
                    <button type="button" className="cs-btn cs-btn-primary" onClick={() => void acknowledgeInsight(insight)}>
                      Mark reviewed
                    </button>
                  )}
                </div>
              )}

              {action.steps.length > 0 && (
                <ol
                  style={{
                    margin: 0,
                    paddingLeft: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '0.9375rem',
                  }}
                >
                  {action.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}

              <div className="cs-card-muted cs-stack" style={{ gap: '4px' }}>
                <div style={{ fontSize: '0.875rem' }}>
                  <strong>Applicability:</strong> {action.applicability}
                </div>
                <div className="cs-helper">
                  <strong>Limitation:</strong> {action.limitation}
                </div>
              </div>

              {action.sourceIds.length > 0 && (
                <div className="cs-row" style={{ gap: '8px' }}>
                  {action.sourceIds.map((sid) => {
                    const src = EVIDENCE_REGISTRY[sid];
                    return (
                      <Link
                        key={sid}
                        to={`/demo/sources/${sid}`}
                        className="cs-btn cs-btn-secondary"
                      >
                        <BookOpen size={15} aria-hidden="true" />
                        <span>View source: {src?.shortTitle ?? sid}{insight ? ` · ${insight.sourceVersions[sid]}` : ''}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
