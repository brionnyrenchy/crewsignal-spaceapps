import React, { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ExternalLink, HardDriveDownload } from 'lucide-react';
import { METRIC_DEFINITIONS } from '../shared';
import { useAppState } from '../state/AppStateContext';

export function SourcesPage() {
  const { sourceId } = useParams<{ sourceId?: string }>();
  const { sources, updateSourceEntry } = useAppState();

  const selectedSource = useMemo(
    () => (sourceId ? sources.find((s) => s.sourceId === sourceId) ?? null : null),
    [sourceId, sources],
  );

  if (sourceId && selectedSource) {
    return (
      <div className="cs-stack" style={{ gap: '20px' }}>
        <div>
          <Link to="/demo/sources" className="cs-btn cs-btn-secondary">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Back to all sources</span>
          </Link>
        </div>

        <article className="cs-card cs-stack" style={{ gap: '14px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <span className="cs-mono-stamp">
              {selectedSource.publisher} · Checked {selectedSource.checkedDate}
            </span>
            <div className="cs-row" style={{ gap: '6px' }}>
              <span
                className={
                  selectedSource.cachedAvailable
                    ? 'cs-pill cs-pill-saved'
                    : 'cs-pill'
                }
              >
                <HardDriveDownload size={13} aria-hidden="true" />
                <span>
                  {selectedSource.cachedAvailable
                    ? selectedSource.offlineAccessNote
                    : 'No cached summary'}
                </span>
              </span>
              {selectedSource.knownUpdateAvailableVersion && (
                <span className="cs-pill">
                  Known update: {selectedSource.knownUpdateAvailableVersion}
                </span>
              )}
            </div>
          </div>

          <h1 className="cs-page-title">{selectedSource.title}</h1>

          <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
            <span className="cs-mono-stamp">
              Offline cached summary ({selectedSource.summaryVersion})
            </span>
            {selectedSource.cachedAvailable ? (
              <p style={{ fontSize: '0.9375rem' }}>{selectedSource.summaryText}</p>
            ) : (
              <p className="cs-helper">
                No cached summary is stored locally for this entry right now.
              </p>
            )}
          </div>

          <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
            <span className="cs-mono-stamp">Scope &amp; limitations</span>
            <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
              {selectedSource.limitations}
            </p>
          </div>

          {selectedSource.relatedMetricIds.length > 0 && (
            <div className="cs-row" style={{ gap: '6px' }}>
              <span className="cs-mono-stamp">Related metrics:</span>
              {selectedSource.relatedMetricIds.map((mId) => (
                <span key={mId} className="cs-pill">
                  {METRIC_DEFINITIONS[mId].shortLabel}
                </span>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              paddingTop: '10px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <span className="cs-mono-value cs-helper" style={{ wordBreak: 'break-all' }}>
              {selectedSource.url}
            </span>

            <a
              href={selectedSource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="cs-btn cs-btn-primary"
            >
              <span>View original source</span>
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="cs-stack" style={{ gap: '20px' }}>
      <header className="cs-page-header" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">Local Evidence &amp; Reference Library</span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Sources
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Concise attributed summaries cached locally for offline inspection. Not agency endorsement or medical direction.
          </p>
        </div>
      </header>

      <div className="cs-stack" style={{ gap: '14px' }}>
        {sources.map((src) => (
          <article key={src.sourceId} className="cs-card cs-stack" style={{ gap: '10px' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <span className="cs-mono-stamp">
                {src.publisher} · Checked {src.checkedDate}
              </span>
              <span className={src.cachedAvailable ? 'cs-pill cs-pill-saved' : 'cs-pill'}>
                {src.cachedAvailable ? src.offlineAccessNote : 'No cached summary'}
              </span>
            </div>

            <h2 className="cs-section-title">{src.title}</h2>

            {src.cachedAvailable ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
                {src.summaryText}
              </p>
            ) : (
              <p className="cs-helper">No cached summary currently stored on this device.</p>
            )}

            <p className="cs-helper">
              <strong>Limitations:</strong> {src.limitations}
            </p>

            <div className="cs-row" style={{ justifyContent: 'space-between' }}>
              <div className="cs-row" style={{ gap: '8px' }}>
                <Link
                  to={`/demo/sources/${src.sourceId}`}
                  className="cs-btn cs-btn-secondary"
                >
                  <BookOpen size={15} aria-hidden="true" />
                  <span>Inspect offline summary</span>
                </Link>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cs-btn cs-btn-ghost"
                >
                  <span>View original source</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>

              <button
                type="button"
                className="cs-btn cs-btn-ghost"
                style={{ fontSize: '0.75rem' }}
                onClick={() =>
                  void updateSourceEntry({
                    ...src,
                    cachedAvailable: !src.cachedAvailable,
                    offlineAccessNote: !src.cachedAvailable
                      ? 'Available offline: summary'
                      : 'No cached summary',
                  })
                }
              >
                {src.cachedAvailable ? 'Simulate uncached' : 'Restore cached summary'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
