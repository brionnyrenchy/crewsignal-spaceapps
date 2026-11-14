import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
  type LayoutChangeEvent,
} from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import {
  BODY_MODEL_DEFAULT_VIEW,
  BODY_MODEL_REGION_TARGETS,
  BODY_MODEL_ROTATE_STEP,
  BODY_MODEL_TAP_SLOP_PX,
  BODY_MODEL_WHOLE_BODY_SYSTEMS,
  BODY_SYSTEM_DEFINITIONS,
  bodyModelRegionLabel,
  bodyModelSelectionCaption,
  dragToRotation,
  rotateBodyModelView,
  shouldClaimRotationGesture,
  type BodyModelView,
  type BodySystemId,
} from '../../shared/src';
import { useCrewTheme } from '../../theme/ThemeProvider';
import { ActionButton, SelectableChip } from '../AppPrimitives';
import type {
  BodyModelColorsNative,
  BodyModelSceneControllerNative,
  CreateBodyModelSceneNative,
} from './bodyModelSceneGL';

/**
 * Evaluates three.js only when the 3D model is first shown, so it costs
 * nothing at app start or for people who stay on the diagram.
 */
const createSceneLazily: CreateBodyModelSceneNative = (gl, options) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('./bodyModelSceneGL') as typeof import('./bodyModelSceneGL')).createBodyModelSceneGL(gl, options);

/** Model colours tuned for lit surfaces; the caption also states selection. */
export const BODY_MODEL_COLORS: Record<'dark' | 'light', BodyModelColorsNative> = {
  dark: { idle: '#565c66', selected: '#f2f4f7', wholeBody: '#9da2aa' },
  light: { idle: '#c4c8ce', selected: '#1f2328', wholeBody: '#7f848b' },
};

export interface BodyModelGLProps {
  selectedId: BodySystemId;
  onSelect: (id: BodySystemId) => void;
  onFailure: (reason: 'load_error') => void;
  /** Test seam; production uses the three.js Expo GL scene. */
  createScene?: CreateBodyModelSceneNative;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export function BodyModelGL({
  selectedId,
  onSelect,
  onFailure,
  createScene = createSceneLazily,
}: BodyModelGLProps): React.ReactElement {
  const { palette, resolvedMode, fontSansRegular, fontSansMedium } = useCrewTheme();
  const appActive = useAppActive();
  const controllerRef = useRef<BodyModelSceneControllerNative | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const viewRef = useRef<BodyModelView>({ ...BODY_MODEL_DEFAULT_VIEW });
  const layoutRef = useRef({ w: 0, h: 0 });
  const selectedRef = useRef(selectedId);
  const colorsRef = useRef(BODY_MODEL_COLORS[resolvedMode]);
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  const releaseRenderer = () => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
    const gl = glRef.current;
    glRef.current = null;
    if (gl) void GLView.destroyContextAsync?.(gl).catch(() => undefined);
  };

  // Free GPU resources when the app is backgrounded or the view unmounts.
  useEffect(() => {
    if (!appActive) {
      releaseRenderer();
      setReady(false);
    }
  }, [appActive]);
  useEffect(() => () => releaseRenderer(), []);

  useEffect(() => {
    selectedRef.current = selectedId;
    controllerRef.current?.setSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    colorsRef.current = BODY_MODEL_COLORS[resolvedMode];
    controllerRef.current?.setColors(colorsRef.current);
  }, [resolvedMode]);

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    try {
      glRef.current = gl;
      controllerRef.current = createScene(gl, {
        colors: colorsRef.current,
        selectedId: selectedRef.current,
        view: viewRef.current,
        widthDp: layoutRef.current.w || 1,
        heightDp: layoutRef.current.h || 1,
      });
      setReady(true);
    } catch {
      releaseRenderer();
      onFailureRef.current('load_error');
    }
  };

  const setView = (next: BodyModelView) => {
    viewRef.current = next;
    controllerRef.current?.setView(next);
  };

  // Horizontal drags rotate; vertical drags are left to the page ScrollView.
  const gesture = useRef({ rotating: false, startX: 0, startY: 0, lastDx: 0 });
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => shouldClaimRotationGesture(g.dx, g.dy),
        onShouldBlockNativeResponder: () => false,
        onPanResponderTerminationRequest: () => !gesture.current.rotating,
        onPanResponderGrant: (e) => {
          gesture.current = {
            rotating: false,
            startX: e.nativeEvent.locationX,
            startY: e.nativeEvent.locationY,
            lastDx: 0,
          };
        },
        onPanResponderMove: (_e, g) => {
          const s = gesture.current;
          if (!s.rotating && shouldClaimRotationGesture(g.dx, g.dy)) s.rotating = true;
          if (!s.rotating) return;
          const { deltaYaw } = dragToRotation(g.dx - s.lastDx, 0, layoutRef.current.w);
          s.lastDx = g.dx;
          setView(rotateBodyModelView(viewRef.current, -deltaYaw, 0));
        },
        onPanResponderRelease: (_e, g) => {
          const s = gesture.current;
          if (s.rotating || Math.hypot(g.dx, g.dy) > BODY_MODEL_TAP_SLOP_PX) return;
          const hit = controllerRef.current?.pick(s.startX, s.startY) ?? null;
          if (hit) onSelectRef.current(hit);
        },
        onPanResponderTerminate: () => {
          gesture.current.rotating = false;
        },
      }),
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    layoutRef.current = { w: width, h: height };
    controllerRef.current?.resize(width, height);
  };

  const nameOf = (id: BodySystemId) => BODY_SYSTEM_DEFINITIONS.find((s) => s.id === id)?.name ?? id;

  return (
    <View style={styles.container} testID="body-model-gl">
      <View
        style={[
          styles.stage,
          { borderColor: palette.borderSubtle, borderRadius: palette.radiusCard, backgroundColor: palette.surfaceRaised },
        ]}
        onLayout={onLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel="3D anatomical navigation illustration. Drag sideways to rotate. Region buttons below and the system list select the same systems."
        testID="body-model-stage"
        {...panResponder.panHandlers}
      >
        {appActive ? (
          <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} testID="body-model-glview" />
        ) : null}
        {!ready ? (
          <Text style={[styles.loading, { color: palette.textSupporting, fontFamily: fontSansRegular }]}>
            Loading 3D model…
          </Text>
        ) : null}
      </View>

      <Text
        testID="body-model-caption"
        style={{ fontFamily: fontSansMedium, fontSize: 13, lineHeight: 19, color: palette.textBody, textAlign: 'center' }}
      >
        {bodyModelSelectionCaption(selectedId)}
      </Text>

      <View style={styles.wrap}>
        {BODY_MODEL_REGION_TARGETS.map((t) => (
          <SelectableChip
            key={t.systemId}
            testID={`model-region-${t.systemId}`}
            label={t.regionLabel}
            selected={selectedId === t.systemId}
            onPress={() => onSelect(t.systemId)}
            accessibilityLabel={`Select ${bodyModelRegionLabel(t)}`}
          />
        ))}
        {BODY_MODEL_WHOLE_BODY_SYSTEMS.map((id) => (
          <SelectableChip
            key={id}
            testID={`model-region-${id}`}
            label={nameOf(id)}
            selected={selectedId === id}
            onPress={() => onSelect(id)}
          />
        ))}
      </View>

      <View style={styles.wrap}>
        <ActionButton
          testID="model-rotate-left"
          label="Rotate left"
          variant="subtle"
          onPress={() => setView(rotateBodyModelView(viewRef.current, BODY_MODEL_ROTATE_STEP))}
        />
        <ActionButton
          testID="model-rotate-right"
          label="Rotate right"
          variant="subtle"
          onPress={() => setView(rotateBodyModelView(viewRef.current, -BODY_MODEL_ROTATE_STEP))}
        />
        <ActionButton
          testID="model-reset-view"
          label="Reset view"
          variant="secondary"
          onPress={() => setView({ ...BODY_MODEL_DEFAULT_VIEW })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  stage: {
    width: '100%',
    maxWidth: 360,
    height: 320,
    alignSelf: 'center',
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loading: { fontSize: 13 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
});
