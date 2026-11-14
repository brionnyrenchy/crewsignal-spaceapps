import React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  ClipboardPlus,
  Compass,
  Download,
  FileText,
  HardDriveDownload,
  HelpCircle,
  Home,
  LayoutGrid,
  Monitor,
  Moon,
  MoreHorizontal,
  Settings,
  Sun,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';
import type { AppearancePreference } from '../shared';
import { useAppState } from '../state/AppStateContext';
import { UpdateConfirmModal } from './ConfirmModals';

const PRIMARY_NAV = [
  { to: '/demo', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/demo/check-in', label: 'Check-in', icon: ClipboardPlus, end: false },
  { to: '/demo/trends', label: 'Trends', icon: Activity, end: false },
  { to: '/demo/explorer', label: 'Explorer', icon: Compass, end: false },
] as const;

const SECONDARY_NAV = [
  { to: '/demo/actions', label: 'Actions', icon: FileText },
  { to: '/demo/reports', label: 'Reports', icon: Download },
  { to: '/demo/sources', label: 'Sources', icon: BookOpen },
  { to: '/demo/settings', label: 'Settings', icon: Settings },
  { to: '/demo/help', label: 'Help', icon: HelpCircle },
] as const;

const APPEARANCE_OPTIONS: ReadonlyArray<{
  value: AppearancePreference;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    loading,
    loadError,
    reloadSnapshot,
    preferences,
    resolvedTheme,
    setAppearance,
    activeProfile,
    currentMissionDay,
    hasUncommittedDraft,
    unretainedDrafts,
    offlineDiagnostics,
    updateModalOpen,
    setUpdateModalOpen,
    applyPendingSwUpdate,
    announcement,
  } = useAppState();

  const profileStamp = activeProfile
    ? `${activeProfile.alias ?? activeProfile.label} · ${activeProfile.missionName} · Mission day ${currentMissionDay}`
    : `SIM-01 · Transit habitat · Mission day ${currentMissionDay}`;

  const offlineLabel = !offlineDiagnostics.online
    ? 'Offline'
    : offlineDiagnostics.readiness === 'ready'
      ? 'Offline ready'
      : offlineDiagnostics.readiness === 'incomplete'
        ? 'Offline setup incomplete'
        : 'Browser mode';

  return (
    <div className="cs-app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Desktop 240px Sidebar / Tablet 88px Compact Labelled Rail */}
      <aside className="cs-sidebar no-print" aria-label="Workspace navigation">
        <div className="cs-stack" style={{ gap: '16px' }}>
          <Link to="/" className="cs-sidebar-brand-link">
            <svg
              width="24"
              height="24"
              viewBox="0 0 32 32"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <rect
                x="1"
                y="1"
                width="30"
                height="30"
                rx="7"
                fill="var(--bg-surface-elevated)"
                stroke="var(--border-strong)"
                strokeWidth="1.5"
              />
              <path
                d="M7 18h4l2.5-6 4 11 2.5-5H25"
                fill="none"
                stroke="var(--text-primary)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="cs-sidebar-brand-copy">
              <div style={{ fontWeight: 590, fontSize: '0.9375rem' }}>
                CrewSignal
              </div>
              <div className="cs-mono-stamp">Crew member 01</div>
            </div>
          </Link>

          <nav aria-label="Primary sections">
            <ul className="cs-nav-list">
              {PRIMARY_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className="cs-nav-link"
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
              {SECONDARY_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink to={item.to} className="cs-nav-link">
                      <Icon size={18} aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <div className="cs-sidebar-footer-meta cs-stack" style={{ gap: '10px' }}>
          <Link to="/" className="cs-btn cs-btn-ghost" style={{ justifyContent: 'flex-start' }}>
            <Home size={16} aria-hidden="true" />
            <span>Landing page</span>
          </Link>
          <div className="cs-card-muted" style={{ padding: '10px' }}>
            <div className="cs-mono-stamp">Research demo</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Synthetic mission dataset only. Not medical diagnosis or flight clearance.
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="cs-topbar no-print">
          <div className="cs-row" style={{ gap: '8px' }}>
            <span className="cs-pill">Research demo · Synthetic data</span>
            <span className="cs-mono-stamp">{profileStamp}</span>
          </div>

          <div className="cs-row" style={{ gap: '8px' }}>
            <span
              className={
                offlineDiagnostics.readiness === 'ready' && offlineDiagnostics.online
                  ? 'cs-pill cs-pill-saved'
                  : 'cs-pill'
              }
              title={offlineDiagnostics.detailMessage}
            >
              {!offlineDiagnostics.online ? (
                <WifiOff size={14} aria-hidden="true" />
              ) : offlineDiagnostics.readiness === 'ready' ? (
                <HardDriveDownload size={14} aria-hidden="true" />
              ) : (
                <AlertTriangle size={14} aria-hidden="true" />
              )}
              <span>{offlineLabel}</span>
            </span>

            {offlineDiagnostics.updateWaiting && (
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                style={{ minHeight: '44px' }}
                onClick={() => setUpdateModalOpen(true)}
              >
                Update ready
              </button>
            )}

            <div
              role="group"
              aria-label="Appearance"
              className="cs-row"
              style={{
                gap: '2px',
                background: 'var(--bg-subtle)',
                padding: '2px',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {APPEARANCE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = preferences.appearance === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={active ? 'cs-btn cs-btn-primary' : 'cs-btn cs-btn-ghost'}
                    aria-pressed={active}
                    aria-label={`Appearance: ${opt.label}${opt.value === 'system' ? ` (${resolvedTheme})` : ''}`}
                    style={{ minHeight: '44px', padding: '0 10px', fontSize: '0.75rem' }}
                    onClick={() => {
                      void setAppearance(opt.value);
                    }}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <Link
              to="/demo/help"
              className="cs-btn cs-btn-secondary"
              aria-label="Open Help"
              style={{ minHeight: '44px', padding: '0 12px' }}
            >
              <HelpCircle size={16} aria-hidden="true" />
              <span>Help</span>
            </Link>
          </div>
        </header>

        <main id="main-content" className="cs-main" tabIndex={-1}>
          {hasUncommittedDraft && !location.pathname.startsWith('/demo/check-in') && (
            <div className="cs-banner no-print" style={{ marginBottom: '16px' }}>
              <div>
                <strong>{unretainedDrafts.length > 0 ? 'Draft only in this tab' : 'Draft kept on this device'}</strong>
                <span style={{ marginLeft: '8px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  {unretainedDrafts.length > 0
                    ? 'Browser storage could not keep your check-in draft. Resume it to finish or download a recovery copy before closing this tab.'
                    : 'You have an uncommitted check-in draft ready to resume.'}
                </span>
              </div>
              <Link
                to={
                  unretainedDrafts.length > 0
                    ? `/demo/check-in?metric=${unretainedDrafts[0]?.metricId ?? 'blood_pressure'}`
                    : '/demo/check-in'
                }
                className="cs-btn cs-btn-secondary"
              >
                Resume draft
              </Link>
            </div>
          )}

          {loading ? (
            <div className="cs-card">
              <p className="cs-mono-stamp">Loading stored workspace</p>
              <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>
                Reading local CrewSignal observations and references on this device…
              </p>
            </div>
          ) : loadError ? (
            <div className="cs-card cs-banner-error cs-stack" role="alert">
              <h1 className="cs-section-title">Stored log unavailable</h1>
              <p>{loadError}</p>
              <div className="cs-row">
                <button
                  type="button"
                  className="cs-btn cs-btn-primary"
                  onClick={() => {
                    void reloadSnapshot();
                  }}
                >
                  Retry loading log
                </button>
                <Link to="/demo/help" className="cs-btn cs-btn-secondary">
                  Open Help offline
                </Link>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      {/* Phone 5-item bottom navigation */}
      <nav className="cs-bottomnav no-print" aria-label="Mobile navigation">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="cs-bottomnav-link"
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        <NavLink to="/demo/more" className="cs-bottomnav-link">
          <MoreHorizontal size={18} aria-hidden="true" />
          <span>More</span>
        </NavLink>
      </nav>

      <UpdateConfirmModal
        open={updateModalOpen}
        hasUncommittedDraft={hasUncommittedDraft}
        onLater={() => setUpdateModalOpen(false)}
        onReviewDraft={() => {
          setUpdateModalOpen(false);
          navigate('/demo/check-in');
        }}
        onInstallNow={() => {
          void applyPendingSwUpdate();
        }}
      />
    </div>
  );
}
