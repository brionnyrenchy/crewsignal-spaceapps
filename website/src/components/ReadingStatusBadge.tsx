import type { CSSProperties } from 'react';
import {
  DARK_THEME_TOKENS,
  LIGHT_THEME_TOKENS,
  READING_STATUSES,
  READING_STATUS_ORDER,
  type ReadingStatus,
} from '../shared';
import '../shared/tokens/reading-status.css';

export function ReadingStatusBadge({ status, id }: { status: ReadingStatus; id?: string }) {
  const { label, icon } = READING_STATUSES[status];
  const dark = DARK_THEME_TOKENS.readingStatus[status];
  const light = LIGHT_THEME_TOKENS.readingStatus[status];
  const colors = {
    '--reading-status-dark-fg': dark.fg,
    '--reading-status-dark-bg': dark.bg,
    '--reading-status-light-fg': light.fg,
    '--reading-status-light-bg': light.bg,
  } as CSSProperties;

  return (
    <span id={id} className="reading-status" style={colors}>
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

export function ReadingStatusLegend() {
  return (
    <>
      <h2 className="cs-section-title">Reading status legend</h2>
      <ul className="reading-status-legend">
        {READING_STATUS_ORDER.map((status) => (
          <li key={status}>
            <ReadingStatusBadge status={status} />
            {READING_STATUSES[status].description}
          </li>
        ))}
      </ul>
    </>
  );
}
