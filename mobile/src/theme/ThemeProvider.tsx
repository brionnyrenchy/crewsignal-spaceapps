import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import type { AppearancePreference } from '../shared/src';
import { resolveFontFamily } from '../platform/fonts';
import {
  MOBILE_DARK_PALETTE,
  MOBILE_LIGHT_PALETTE,
  NARROW_BREAKPOINT_DP,
  TABLET_BREAKPOINT_DP,
  type MobileThemePalette,
  type ResolvedThemeMode,
} from './tokens';

export interface MobileThemeContextValue {
  appearance: AppearancePreference;
  resolvedMode: ResolvedThemeMode;
  palette: MobileThemePalette;
  fontsLoaded: boolean;
  reduceMotion: boolean;
  width: number;
  height: number;
  fontScale: number;
  isTablet: boolean;
  isNarrow: boolean;
  useSingleColumnCards: boolean;
  fontSansRegular: string | undefined;
  fontSansMedium: string | undefined;
  fontSansSemiBold: string | undefined;
  fontMonoRegular: string | undefined;
  fontMonoMedium: string | undefined;
}

const ThemeContext = createContext<MobileThemeContextValue | null>(null);

export interface ThemeProviderProps {
  appearance: AppearancePreference;
  fontsLoaded: boolean;
  children: React.ReactNode;
}

export function CrewSignalThemeProvider({
  appearance,
  fontsLoaded,
  children,
}: ThemeProviderProps): React.ReactElement {
  const systemScheme = useColorScheme();
  const dimensions = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled: boolean) => {
        setReduceMotion(Boolean(enabled));
      },
    );

    return () => {
      active = false;
      sub?.remove?.();
    };
  }, []);

  const resolvedMode: ResolvedThemeMode = useMemo(() => {
    if (appearance === 'dark') return 'dark';
    if (appearance === 'light') return 'light';
    return systemScheme === 'light' ? 'light' : 'dark';
  }, [appearance, systemScheme]);

  const value = useMemo<MobileThemeContextValue>(() => {
    const palette = resolvedMode === 'light' ? MOBILE_LIGHT_PALETTE : MOBILE_DARK_PALETTE;
    const isTablet = dimensions.width >= TABLET_BREAKPOINT_DP;
    const isNarrow = dimensions.width < NARROW_BREAKPOINT_DP;
    const useSingleColumnCards =
      dimensions.width < NARROW_BREAKPOINT_DP || dimensions.fontScale >= 1.35;

    return {
      appearance,
      resolvedMode,
      palette,
      fontsLoaded,
      reduceMotion,
      width: dimensions.width,
      height: dimensions.height,
      fontScale: dimensions.fontScale,
      isTablet,
      isNarrow,
      useSingleColumnCards,
      fontSansRegular: resolveFontFamily('sansRegular', fontsLoaded),
      fontSansMedium: resolveFontFamily('sansMedium', fontsLoaded),
      fontSansSemiBold: resolveFontFamily('sansSemiBold', fontsLoaded),
      fontMonoRegular: resolveFontFamily('monoRegular', fontsLoaded),
      fontMonoMedium: resolveFontFamily('monoMedium', fontsLoaded),
    };
  }, [appearance, dimensions.fontScale, dimensions.height, dimensions.width, fontsLoaded, reduceMotion, resolvedMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useCrewTheme(): MobileThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useCrewTheme must be used inside CrewSignalThemeProvider');
  }
  return ctx;
}
