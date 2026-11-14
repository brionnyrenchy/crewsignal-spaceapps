import type { ReadingStatus } from './readingStatus';

/**
 * Canonical CrewSignal semantic design tokens matching root DESIGN.md.
 * Dark theme follows GradientDeck Linear; Light theme follows full Vercel reference.
 */
export interface ThemePaletteTokens {
  surfaceCanvas: string;
  surfacePanel: string;
  surfaceRaised: string;
  borderSubtle: string;
  borderControl: string;
  textPrimary: string;
  textBody: string;
  textSupporting: string;
  actionPrimaryBg: string;
  actionPrimaryFg: string;
  focusRing: string;
  seriesMeasured: string;
  seriesReference: string;
  reviewFg: string;
  reviewBadgeBg: string;
  confirmationFg: string;
  readingStatus: Record<ReadingStatus, { fg: string; bg: string }>;
  radiusCard: number;
  radiusControl: number;
  radiusBadge: number;
  radiusPill: number;
  weightHeading: number;
  weightBody: number;
  cardRingShadow: string;
}

export const DARK_THEME_TOKENS: ThemePaletteTokens = {
  surfaceCanvas: '#08090a',
  surfacePanel: '#0f1011',
  surfaceRaised: '#161718',
  borderSubtle: '#30343b',
  borderControl: '#707985',
  textPrimary: '#ffffff',
  textBody: '#d0d6e0',
  textSupporting: '#8a8f98',
  actionPrimaryBg: '#e4f222',
  actionPrimaryFg: '#08090a',
  focusRing: '#e4f222',
  seriesMeasured: '#67d1dc',
  seriesReference: '#a5acb7',
  reviewFg: '#f6bf58',
  reviewBadgeBg: '#211c12',
  confirmationFg: '#27a644',
  readingStatus: {
    near: { fg: '#9ae6d3', bg: '#132925' },
    differs: { fg: '#f6cf87', bg: '#302415' },
    no_reference: { fg: '#d8ccf1', bg: '#282039' },
    stale: { fg: '#b8d5f9', bg: '#1b2a40' },
    not_logged: { fg: '#d0d6e0', bg: '#252830' },
  },
  radiusCard: 12,
  radiusControl: 6,
  radiusBadge: 4,
  radiusPill: 9999,
  weightHeading: 510,
  weightBody: 400,
  cardRingShadow: 'inset 0 0 0 1px #30343b',
};

export const LIGHT_THEME_TOKENS: ThemePaletteTokens = {
  surfaceCanvas: '#fafafa',
  surfacePanel: '#ffffff',
  surfaceRaised: '#f0f0f0',
  borderSubtle: '#ebebeb',
  borderControl: '#7d7d7d',
  textPrimary: '#171717',
  textBody: '#4d4d4d',
  textSupporting: '#666666',
  actionPrimaryBg: '#171717',
  actionPrimaryFg: '#ffffff',
  focusRing: '#171717',
  seriesMeasured: '#171717',
  seriesReference: '#666666',
  reviewFg: '#171717',
  reviewBadgeBg: '#f0f0f0',
  confirmationFg: '#297a3a',
  readingStatus: {
    near: { fg: '#155349', bg: '#e1f3ee' },
    differs: { fg: '#714508', bg: '#fff0d5' },
    no_reference: { fg: '#523b77', bg: '#f1eafa' },
    stale: { fg: '#264e7f', bg: '#e8f1ff' },
    not_logged: { fg: '#494f59', bg: '#edf0f4' },
  },
  radiusCard: 6,
  radiusControl: 6,
  radiusBadge: 6,
  radiusPill: 9999,
  weightHeading: 450,
  weightBody: 400,
  cardRingShadow: '0 0 0 1px rgba(0, 0, 0, 0.08), 0 0 0 2px #fafafa',
};

export const TYPOGRAPHY_TOKENS = {
  fontSansFamily: 'Inter Variable',
  fontSansStack:
    "'Inter Variable', 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontMonoFamily: 'Geist Mono',
  fontMonoStack:
    "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  sizes: {
    metadata: 12,
    metadataMax: 13,
    supporting: 14,
    body: 16,
    panelHeading: 20,
    metricValue: 28,
    metricValueMax: 32,
    pageTitleLight: 30,
    pageTitleDark: 32,
    heroTitle: 56,
  },
  lineHeights: {
    pageTitleLight: 1.1,
    pageTitleDark: 1.13,
    supporting: 1.43,
    body: 1.5,
    metadata: 1.5,
    hero: 1.0,
  },
  letterSpacing: {
    monoStampEm: 0.071,
    pageTitleLightPx: -1.5,
    pageTitleDarkEm: -0.022,
    heroLightPx: -3.36,
    heroDarkEm: -0.022,
  },
} as const;

export const LAYOUT_TOKENS = {
  baseGridPx: 4,
  spacingScalePx: [4, 8, 12, 16, 20, 24, 32, 40, 44, 64, 96, 128] as const,
  desktopSidebarWidthPx: 240,
  tabletRailMinWidthPx: 88,
  topBarHeightPx: 64,
  minTargetWebDesktopPx: 44,
  minTargetNativeMobileUnits: 48,
  breakpointsPx: {
    narrowReflow: 320,
    phoneTarget: 390,
    tabletTarget: 768,
    desktopTarget: 1440,
  },
} as const;

export const THEME_TOKENS = {
  schemaVersion: 2,
  dark: DARK_THEME_TOKENS,
  light: LIGHT_THEME_TOKENS,
  typography: TYPOGRAPHY_TOKENS,
  layout: LAYOUT_TOKENS,
} as const;
