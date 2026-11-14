import React, { Component, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import {
  bodyVisualStatusMessage,
  resolveBodyVisualMode,
  type BodySystemId,
  type BodyVisualPreference,
} from '../shared/src';
import { useCrewTheme } from '../theme/ThemeProvider';
import { ActionButton, SelectableChip } from './AppPrimitives';
import { BodyDiagramSvg } from './BodyDiagramSvg';
import { BodyModelGL } from './bodyModel/BodyModelGL';
import type { CreateBodyModelSceneNative } from './bodyModel/bodyModelSceneGL';

/**
 * The Android model stays opt-in ("3D model (preview)") until the pinned
 * Expo SDK 58 / expo-gl / three.js setup passes on an installed APK on a phone
 * and a tablet (see EVIDENCE.md). After that, set this to true to make the
 * model the default. The SVG diagram and the list keep working either way.
 */
export const ANDROID_MODEL_DEFAULT = false;

class ModelErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function BodyExplorerVisual({
  selectedSystemId,
  onSelectSystem,
  statusBySystem,
  modelDefault = ANDROID_MODEL_DEFAULT,
  createScene,
}: {
  selectedSystemId: BodySystemId;
  onSelectSystem: (id: BodySystemId) => void;
  statusBySystem: Record<BodySystemId, string>;
  modelDefault?: boolean;
  createScene?: CreateBodyModelSceneNative;
}): React.ReactElement {
  const { palette, reduceMotion, fontSansRegular } = useCrewTheme();
  const [preference, setPreference] = useState<BodyVisualPreference>('auto');
  const [loadError, setLoadError] = useState(false);
  // Android reports reduced motion asynchronously. Until it answers, the
  // automatic choice stays on the diagram so the model never flashes up.
  const [motionKnown, setMotionKnown] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .finally(() => {
        if (active) setMotionKnown(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const decision = resolveBodyVisualMode({
    preference,
    reducedMotion: reduceMotion || !motionKnown,
    // expo-gl ships with the app binary; a failed context is reported as a load error.
    support: 'available',
    loadError,
    modelDefaultOnPlatform: modelDefault,
  });
  const status =
    decision.reason === 'reduced_motion' && !reduceMotion ? null : bodyVisualStatusMessage(decision.reason);

  return (
    <View style={styles.container}>
      {decision.modelOffered ? (
        <View style={styles.row} accessibilityLabel="Body map view">
          <SelectableChip
            testID="explorer-visual-diagram"
            label="Diagram"
            selected={decision.mode === 'diagram'}
            onPress={() => setPreference('diagram')}
          />
          <SelectableChip
            testID="explorer-visual-model"
            label={modelDefault ? '3D model' : '3D model (preview)'}
            selected={decision.mode === 'model'}
            onPress={() => setPreference('model')}
          />
        </View>
      ) : null}

      {status ? (
        <Text
          testID="explorer-visual-status"
          accessibilityLiveRegion="polite"
          style={{ fontFamily: fontSansRegular, fontSize: 13, lineHeight: 19, color: palette.textSupporting }}
        >
          {status}
        </Text>
      ) : null}
      {decision.reason === 'load_error' ? (
        <ActionButton
          testID="explorer-visual-retry"
          label="Try the 3D model again"
          variant="subtle"
          onPress={() => {
            setLoadError(false);
            setPreference('model');
          }}
        />
      ) : null}

      {decision.mode === 'model' ? (
        <ModelErrorBoundary onError={() => setLoadError(true)}>
          <BodyModelGL
            selectedId={selectedSystemId}
            onSelect={onSelectSystem}
            onFailure={() => setLoadError(true)}
            createScene={createScene}
          />
        </ModelErrorBoundary>
      ) : (
        <BodyDiagramSvg
          selectedSystemId={selectedSystemId}
          onSelectSystem={onSelectSystem}
          statusBySystem={statusBySystem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
