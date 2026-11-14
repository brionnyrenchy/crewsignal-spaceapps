import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { AccessibilityInfo, AppState, Pressable, Text, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BODY_MODEL_DEFAULT_VIEW, BODY_SYSTEM_DEFINITIONS, type BodyModelView, type BodySystemId } from '../src/shared/src';
import { CrewSignalThemeProvider } from '../src/theme/ThemeProvider';
import { BodyExplorerVisual } from '../src/components/BodyExplorerVisual';
import type {
  BodyModelSceneOptionsNative,
  CreateBodyModelSceneNative,
} from '../src/components/bodyModel/bodyModelSceneGL';

// GLView stand-in: hands a minimal (non-functional) GL context to onContextCreate.
jest.mock('expo-gl', () => {
  const React = require('react');
  const { View } = require('react-native');
  function GLView(props: { onContextCreate: (gl: unknown) => void; testID?: string }) {
    React.useEffect(() => {
      props.onContextCreate({ drawingBufferWidth: 300, drawingBufferHeight: 320, endFrameEXP: () => undefined });
    }, []);
    return React.createElement(View, { testID: props.testID });
  }
  GLView.destroyContextAsync = jest.fn(async () => true);
  return { GLView };
});

interface FakeScene {
  options: BodyModelSceneOptionsNative;
  selected: BodySystemId[];
  views: BodyModelView[];
  disposed: boolean;
}

function fakeScenes() {
  const scenes: FakeScene[] = [];
  const createScene: CreateBodyModelSceneNative = (_gl, options) => {
    const s: FakeScene = { options, selected: [options.selectedId], views: [options.view], disposed: false };
    scenes.push(s);
    return {
      setSelected: (id) => void s.selected.push(id),
      setView: (v) => void s.views.push(v),
      setColors: () => undefined,
      resize: () => undefined,
      pick: () => null,
      dispose: () => {
        s.disposed = true;
      },
    };
  };
  return { scenes, createScene };
}

/** Mirrors ExplorerScreen: list and visual share one selection. */
function Harness(props: { createScene?: CreateBodyModelSceneNative; modelDefault?: boolean }) {
  const [selected, setSelected] = useState<BodySystemId>('sleep_cognition');
  const status = Object.fromEntries(BODY_SYSTEM_DEFINITIONS.map((s) => [s.id, s.coverageLabel])) as Record<BodySystemId, string>;
  return (
    <CrewSignalThemeProvider appearance="dark" fontsLoaded>
      <View>
        {BODY_SYSTEM_DEFINITIONS.map((s) => (
          <Pressable
            key={s.id}
            testID={`list-${s.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === s.id }}
            onPress={() => setSelected(s.id)}
          >
            <Text>{s.name}</Text>
          </Pressable>
        ))}
        <Text testID="selected">{selected}</Text>
        <BodyExplorerVisual
          selectedSystemId={selected}
          onSelectSystem={setSelected}
          statusBySystem={status}
          modelDefault={props.modelDefault}
          createScene={props.createScene}
        />
      </View>
    </CrewSignalThemeProvider>
  );
}

describe('Android Explorer 3D model', () => {
  let appStateListeners: ((s: string) => void)[] = [];
  beforeEach(() => {
    appStateListeners = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, cb: (s: string) => void) => {
      appStateListeners.push(cb);
      return { remove: () => undefined };
    }) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps the diagram as the default until device verification, with the model offered', async () => {
    const { scenes, createScene } = fakeScenes();
    await render(<Harness createScene={createScene} />);
    expect(screen.getByTestId('diagram-node-cardiovascular')).toBeTruthy();
    expect(screen.getByText('3D model (preview)')).toBeTruthy();
    expect(screen.queryByTestId('body-model-glview')).toBeNull();
    expect(scenes).toHaveLength(0);
  });

  test('model regions, region chips and the list share one selection', async () => {
    const { scenes, createScene } = fakeScenes();
    await render(<Harness createScene={createScene} />);
    await fireEvent.press(screen.getByTestId('explorer-visual-model'));
    await waitFor(() => expect(scenes).toHaveLength(1));

    await fireEvent.press(screen.getByTestId('list-cardiovascular'));
    expect(scenes[0]!.selected.at(-1)).toBe('cardiovascular');
    expect(screen.getByTestId('model-region-cardiovascular')).toBeSelected();
    expect(screen.getByTestId('body-model-caption')).toHaveTextContent('Selected: Chest, Cardiovascular (Manual observation).');

    await fireEvent.press(screen.getByTestId('model-region-musculoskeletal'));
    expect(screen.getByTestId('selected')).toHaveTextContent('musculoskeletal');
    expect(screen.getByTestId('list-musculoskeletal')).toBeSelected();
    expect(screen.getByLabelText('Select Limbs: Musculoskeletal, Not assessed')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('model-region-immune_context'));
    expect(screen.getByTestId('body-model-caption')).toHaveTextContent(/Whole-body context/);

    await fireEvent.press(screen.getByTestId('model-rotate-right'));
    expect(scenes[0]!.views.at(-1)).not.toEqual(BODY_MODEL_DEFAULT_VIEW);
    await fireEvent.press(screen.getByTestId('model-reset-view'));
    expect(scenes[0]!.views.at(-1)).toEqual(BODY_MODEL_DEFAULT_VIEW);
  });

  test('where the model is the default, it opens once reduced motion is known to be off', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { scenes, createScene } = fakeScenes();
    await render(<Harness createScene={createScene} modelDefault />);
    await waitFor(() => expect(scenes).toHaveLength(1));
    expect(scenes[0]!.disposed).toBe(false);
    expect(screen.getByText('3D model')).toBeTruthy();
  });

  test('releases the renderer when backgrounded and restores it on return', async () => {
    const { scenes, createScene } = fakeScenes();
    const view = await render(<Harness createScene={createScene} />);
    await fireEvent.press(screen.getByTestId('explorer-visual-model'));
    await waitFor(() => expect(scenes).toHaveLength(1));

    await act(async () => appStateListeners.forEach((cb) => cb('background')));
    expect(scenes[0]!.disposed).toBe(true);
    expect(screen.queryByTestId('body-model-glview')).toBeNull();

    await act(async () => appStateListeners.forEach((cb) => cb('active')));
    await waitFor(() => expect(scenes).toHaveLength(2));
    expect(screen.getByTestId('body-model-glview')).toBeTruthy();

    await view.unmount();
    expect(scenes[1]!.disposed).toBe(true);
  });

  test('simulated renderer failure on the real three.js path falls back to diagram and list', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId('explorer-visual-model'));
    expect(await screen.findByTestId('explorer-visual-status')).toHaveTextContent(/could not be shown/);
    expect(screen.getByTestId('diagram-node-nutrition_metabolism')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('diagram-node-nutrition_metabolism'));
    expect(screen.getByTestId('selected')).toHaveTextContent('nutrition_metabolism');
    expect(screen.getByTestId('explorer-visual-retry')).toBeTruthy();
  });

  test('reduced motion keeps the diagram even where the model is the default', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { scenes, createScene } = fakeScenes();
    await render(<Harness createScene={createScene} modelDefault />);
    expect(await screen.findByTestId('explorer-visual-status')).toHaveTextContent(/reduced motion/);
    await act(async () => undefined);
    expect(screen.getByTestId('diagram-node-cardiovascular')).toBeTruthy();
    expect(scenes).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('explorer-visual-model'));
    await waitFor(() => expect(scenes).toHaveLength(1));
  });
});
