import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, HardDriveDownload, ShieldAlert } from 'lucide-react';
import { resolveHelpContent } from '../shared';
import { useAppState } from '../state/AppStateContext';

export function HelpPage() {
  const { preferences } = useAppState();
  const card = resolveHelpContent(preferences.helpMode);

  return (
    <div className="cs-stack" style={{ gap: '20px' }}>
      <header className="cs-page-header" style={{ marginBottom: 0 }}>
        <div>
          <span className="cs-mono-stamp">Always Accessible · Offline Safe</span>
          <h1 className="cs-page-title" style={{ marginTop: '4px' }}>
            Help
          </h1>
          <p className="cs-helper" style={{ marginTop: '4px' }}>
            Available anytime—including offline or before any check-in or baseline has been recorded.
          </p>
        </div>
      </header>

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
          <div>
            {card.fixtureBanner && (
              <span className="cs-pill" style={{ marginBottom: '6px' }}>
                {card.fixtureBanner}
              </span>
            )}
            <h2 className="cs-section-title">{card.statusTitle}</h2>
          </div>

          <div className="cs-row" style={{ gap: '6px' }}>
            {card.versionLabel && (
              <span className="cs-pill">{card.versionLabel}</span>
            )}
            <span className="cs-pill cs-pill-saved">
              <HardDriveDownload size={13} aria-hidden="true" />
              <span>Available offline</span>
            </span>
          </div>
        </div>

        <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
          {card.body}
        </p>

        <ol
          style={{
            margin: 0,
            paddingLeft: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {card.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <div className="cs-card-muted cs-stack" style={{ gap: '6px' }}>
          <div className="cs-row" style={{ gap: '6px' }}>
            <ShieldAlert size={16} aria-hidden="true" />
            <strong>Prototype limitations</strong>
          </div>
          <p className="cs-helper">{card.limitation}</p>
        </div>

        <div className="cs-card-muted cs-stack" style={{ gap: '4px' }}>
          <span className="cs-mono-stamp">Offline verification facts</span>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {card.offlineFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>

        <div className="cs-row">
          <Link to="/demo/sources" className="cs-btn cs-btn-secondary">
            <BookOpen size={15} aria-hidden="true" />
            <span>Open cached evidence summaries</span>
          </Link>
          <Link to="/demo" className="cs-btn cs-btn-ghost">
            Return to overview
          </Link>
        </div>
      </article>
    </div>
  );
}
