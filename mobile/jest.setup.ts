// Ensure React 19 Concurrent act() warnings/checks work reliably under jest-expo
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// @testing-library/react-native v14 registers extended Jest matchers cleanly via matchers.js
import '@testing-library/react-native/matchers';

// Keep Jest environment deterministic on Windows without native device bridges
jest.mock('expo-font', () => ({
  loadAsync: jest.fn(async () => undefined),
  isLoaded: jest.fn(() => true),
}));

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(async () => true),
  openURL: jest.fn(async () => undefined),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-print', () => ({
  printAsync: jest.fn(async () => undefined),
  printToFileAsync: jest.fn(async () => ({
    uri: 'file:///tmp/crewsignal-report.pdf',
    numberOfPages: 1,
  })),
  Orientation: {
    portrait: 'portrait',
    landscape: 'landscape',
  },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 44, left: 0, right: 0, bottom: 34 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    SafeAreaView: ({ children, style, ...rest }: { children: React.ReactNode; style?: unknown }) =>
      React.createElement(View, { style, ...rest }, children),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { frame, insets },
  };
});
