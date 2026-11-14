import * as Font from 'expo-font';
import { Platform } from 'react-native';

export const CREWSIGNAL_FONT_NAMES = {
  sansRegular: 'Inter-Regular',
  sansMedium: 'Inter-Medium',
  sansSemiBold: 'Inter-SemiBold',
  monoRegular: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
  monoSemiBold: 'GeistMono-SemiBold',
} as const;

let fontsPromise: Promise<boolean> | null = null;

/**
 * Loads locally bundled Inter 4.1 and Geist Mono 1.9.2 TTF fonts offline.
 * Never reaches out to Google Fonts or any remote CDN.
 */
export async function loadBundledFonts(): Promise<boolean> {
  if (fontsPromise) {
    return fontsPromise;
  }

  fontsPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await Font.loadAsync({
        [CREWSIGNAL_FONT_NAMES.sansRegular]: require('../shared/assets/fonts/Inter-Regular.ttf'),
        [CREWSIGNAL_FONT_NAMES.sansMedium]: require('../shared/assets/fonts/Inter-Medium.ttf'),
        [CREWSIGNAL_FONT_NAMES.sansSemiBold]: require('../shared/assets/fonts/Inter-SemiBold.ttf'),
        [CREWSIGNAL_FONT_NAMES.monoRegular]: require('../shared/assets/fonts/GeistMono-Regular.ttf'),
        [CREWSIGNAL_FONT_NAMES.monoMedium]: require('../shared/assets/fonts/GeistMono-Medium.ttf'),
        [CREWSIGNAL_FONT_NAMES.monoSemiBold]: require('../shared/assets/fonts/GeistMono-SemiBold.ttf'),
      });
      return true;
    } catch {
      // Graceful fallback to native platform UI/monospace fonts if asset loading fails in constrained tests
      return false;
    }
  })();

  return fontsPromise;
}

export function resolveFontFamily(
  role: 'sansRegular' | 'sansMedium' | 'sansSemiBold' | 'monoRegular' | 'monoMedium' | 'monoSemiBold',
  fontsLoaded: boolean,
): string | undefined {
  if (fontsLoaded) {
    return CREWSIGNAL_FONT_NAMES[role];
  }
  if (role.startsWith('mono')) {
    return Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    });
  }
  return Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: undefined,
  });
}
