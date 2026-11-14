import {
  DARK_THEME_TOKENS,
  LAYOUT_TOKENS,
  LIGHT_THEME_TOKENS,
  TYPOGRAPHY_TOKENS,
  type ThemePaletteTokens,
} from '../shared/src';

export type ResolvedThemeMode = 'dark' | 'light';

export interface MobileThemePalette extends ThemePaletteTokens {
  mode: ResolvedThemeMode;
  statusBarStyle: 'light' | 'dark';
  dangerFg: string;
  dangerBg: string;
  dangerBorder: string;
  selectionBg: string;
  tabBarBg: string;
  modalBackdrop: string;
}

export const MOBILE_DARK_PALETTE: MobileThemePalette = {
  ...DARK_THEME_TOKENS,
  mode: 'dark',
  statusBarStyle: 'light',
  dangerFg: '#f59e9e',
  dangerBg: '#231315',
  dangerBorder: '#6b2c31',
  selectionBg: 'rgba(228, 242, 34, 0.12)',
  tabBarBg: '#0c0d0e',
  modalBackdrop: 'rgba(0, 0, 0, 0.72)',
};

export const MOBILE_LIGHT_PALETTE: MobileThemePalette = {
  ...LIGHT_THEME_TOKENS,
  mode: 'light',
  statusBarStyle: 'dark',
  dangerFg: '#9f1239',
  dangerBg: '#fff1f2',
  dangerBorder: '#fecdd3',
  selectionBg: 'rgba(23, 23, 23, 0.06)',
  tabBarBg: '#ffffff',
  modalBackdrop: 'rgba(23, 23, 23, 0.44)',
};

export const MIN_NATIVE_TARGET_DP = LAYOUT_TOKENS.minTargetNativeMobileUnits;
export const TABLET_BREAKPOINT_DP = 600;
export const NARROW_BREAKPOINT_DP = 360;

export { TYPOGRAPHY_TOKENS, LAYOUT_TOKENS };
