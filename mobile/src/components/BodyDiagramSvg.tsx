import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import type { BodySystemId } from '../shared/src';
import { useCrewTheme } from '../theme/ThemeProvider';
import { MIN_NATIVE_TARGET_DP } from '../theme/tokens';

interface DiagramNode {
  id: BodySystemId;
  shortLabel: string;
  accessibilityLabel: string;
  cx: number;
  cy: number;
}

const DIAGRAM_NODES: readonly DiagramNode[] = [
  {
    id: 'sleep_cognition',
    shortLabel: 'Sleep & cognition',
    accessibilityLabel: 'Select Head, Sleep and cognition system',
    cx: 110,
    cy: 42,
  },
  {
    id: 'cardiovascular',
    shortLabel: 'Cardiovascular',
    accessibilityLabel: 'Select Chest cardiovascular system',
    cx: 110,
    cy: 116,
  },
  {
    id: 'musculoskeletal',
    shortLabel: 'Musculoskeletal',
    accessibilityLabel: 'Select Limbs musculoskeletal system, Not assessed',
    cx: 54,
    cy: 138,
  },
  {
    id: 'immune_context',
    shortLabel: 'Immune context',
    accessibilityLabel: 'Select Whole-body immune context, Not assessed',
    cx: 166,
    cy: 138,
  },
  {
    id: 'nutrition_metabolism',
    shortLabel: 'Nutrition & metabolism',
    accessibilityLabel: 'Select Whole-body nutrition and metabolism system',
    cx: 110,
    cy: 162,
  },
];

export function BodyDiagramSvg({
  selectedSystemId,
  onSelectSystem,
  statusBySystem,
}: {
  selectedSystemId: BodySystemId;
  onSelectSystem: (id: BodySystemId) => void;
  statusBySystem: Record<BodySystemId, string>;
}): React.ReactElement {
  const { palette, fontSansMedium, fontMonoRegular } = useCrewTheme();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.svgFrame,
          {
            backgroundColor: palette.surfaceRaised,
            borderColor: palette.borderSubtle,
            borderRadius: palette.radiusCard,
          },
        ]}
      >
        <Svg width={220} height={270} viewBox="0 0 220 270" accessible={false}>
          {/* Calm neutral anatomical 2D vector outline */}
          <G stroke={palette.borderControl} strokeWidth={1.6} fill="none">
            {/* Head */}
            <Circle cx={110} cy={42} r={22} />
            {/* Neck & shoulders */}
            <Line x1={110} y1={64} x2={110} y2={76} />
            <Path d="M68 90 Q110 72 152 90" />
            {/* Torso */}
            <Path d="M74 92 L80 182 Q110 190 140 182 L146 92" />
            {/* Arms */}
            <Path d="M68 90 L48 164" strokeLinecap="round" />
            <Path d="M152 90 L172 164" strokeLinecap="round" />
            {/* Legs */}
            <Path d="M88 184 L82 252" strokeLinecap="round" />
            <Path d="M132 184 L138 252" strokeLinecap="round" />
          </G>

          {/* Reference crosshair guide */}
          <Line
            x1={110}
            y1={14}
            x2={110}
            y2={256}
            stroke={palette.borderSubtle}
            strokeDasharray="3 4"
            strokeWidth={1}
          />

          {DIAGRAM_NODES.map((node) => {
            const isSelected = node.id === selectedSystemId;
            return (
              <G key={node.id} onPress={() => onSelectSystem(node.id)}>
                {isSelected ? (
                  <Circle
                    cx={node.cx}
                    cy={node.cy}
                    r={14}
                    fill={palette.selectionBg}
                    stroke={palette.focusRing}
                    strokeWidth={2}
                  />
                ) : null}
                <Circle
                  cx={node.cx}
                  cy={node.cy}
                  r={7}
                  fill={isSelected ? palette.focusRing : palette.surfacePanel}
                  stroke={isSelected ? palette.focusRing : palette.seriesMeasured}
                  strokeWidth={2}
                />
                {node.id === 'immune_context' || node.id === 'musculoskeletal' ? (
                  <Rect
                    x={node.cx - 4}
                    y={node.cy - 4}
                    width={8}
                    height={8}
                    rx={2}
                    stroke={palette.textSupporting}
                    strokeWidth={1.2}
                    fill="none"
                  />
                ) : null}
              </G>
            );
          })}
        </Svg>
      </View>

      {/* Accessible 48dp synchronized hotspot buttons */}
      <View style={styles.hotspotGrid}>
        {DIAGRAM_NODES.map((node) => {
          const isSelected = node.id === selectedSystemId;
          return (
            <Pressable
              key={node.id}
              testID={`diagram-node-${node.id}`}
              onPress={() => onSelectSystem(node.id)}
              accessibilityRole="button"
              accessibilityLabel={`${node.accessibilityLabel}, ${statusBySystem[node.id]}`}
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.hotspotBtn,
                {
                  borderRadius: palette.radiusControl,
                  borderWidth: isSelected ? 2 : 1,
                  borderColor: isSelected ? palette.focusRing : palette.borderControl,
                  backgroundColor: isSelected ? palette.selectionBg : palette.surfacePanel,
                },
              ]}
            >
              <Text
                style={{
                  fontFamily: fontSansMedium,
                  fontSize: 13,
                  color: palette.textPrimary,
                }}
              >
                {node.shortLabel}
              </Text>
              <Text
                style={{
                  fontFamily: fontMonoRegular,
                  fontSize: 11,
                  color: palette.textSupporting,
                }}
              >
                {statusBySystem[node.id]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  svgFrame: {
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hotspotBtn: {
    minHeight: MIN_NATIVE_TARGET_DP,
    minWidth: MIN_NATIVE_TARGET_DP,
    flexGrow: 1,
    flexBasis: '46%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 2,
  },
});
