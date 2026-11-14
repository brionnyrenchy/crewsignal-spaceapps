import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, Lock } from 'lucide-react';
import {
  ACTION_CONTENT_LIST,
  EVIDENCE_REGISTRY,
  buildSleepInsight,
  isInsightReviewCurrent,
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

  const latestSleep = latestByMetric.sleep;
  const computedSleepInsight = useMemo(() => {
    if (!latestSleep) return null;
    return buildSleepInsight({
      observation: latestSleep,
      reference: sleepRef,
      createdAtUtc: activeProfile?.snapshotUtc ?? latestSleep.recordedAtUtc,
    });
  }, [latestSleep, sleepRef, activeProfile]);

  const sleepInsightReviewed = useMemo(() => {
    if (!computedSleepInsight) return false;
    return profileInsights.some((saved) =>
      isInsightReviewCurrent(saved, computedSleepInsight),
    );
  }, [profileInsights, computedSleepInsight]);

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

      {/* Active Triggered Sleep Insight */}
      {computedSleepInsight && (
        <section className="cs-card cs-stack" aria-labelledby="active-insight-heading">
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
              <span className="cs-mono-stamp">Active sleep routine context</span>
              <h2 id="active-insight-heading" className="cs-section-title" style={{ marginTop: '4px' }}>
                {computedSleepInsight.summary}
              </h2>
            </div>

            {sleepInsightReviewed ? (
              <span className="cs-pill cs-pill-saved">
                <CheckCircle2 size={14} aria-hidden="true" />
                <span>Reviewed for current version</span>
              </span>
            ) : (
              <button
                type="button"
                className="cs-btn cs-btn-primary"
                onClick={() => {
                  void acknowledgeInsight(computedSleepInsight);
                }}
              >
                Mark reviewed
              </button>
            )}
          </div>

          <p className="cs-helper">
            Pinned to observation {computedSleepInsight.observationId}, reference version{' '}
            {computedSleepInsight.referenceVersion ?? 'none'}, and rule {computedSleepInsight.ruleVersion}.
            Newer entries or version updates prompt a fresh review.
          </p>
        </section>
      )}

      <div className="cs-stack" style={{ gap: '16px' }}>
        {ACTION_CONTENT_LIST.map((action) => (
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
                <h2 className="cs-section-title" style={{ marginTop: '4px' }}>
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
                      <span>View source: {src?.shortTitle ?? sid}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
