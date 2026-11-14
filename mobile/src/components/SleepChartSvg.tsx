import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useCrewTheme } from '../theme/ThemeProvider';
import { MIN_NATIVE_TARGET_DP } from '../theme/tokens';

export interface TrendPlotPoint {
  missionDay: number;
  value: number | null;
  labelText: string;
}

export function SleepChartSvg({
  points,
  referenceValue,
  referenceLabel,
  yMin = 0,
  yMax = 10,
  yTickValues = [0, 5, 10],
  formatYTick = (v: number) => `${v}h`,
  xTickDays,
  rangeDays,
}: {
  points: readonly TrendPlotPoint[];
  referenceValue: number | null;
  referenceLabel: string | null;
  yMin?: number;
  yMax?: number;
  yTickValues?: readonly number[];
  formatYTick?: (v: number) => string;
  xTickDays?: readonly number[];
  rangeDays: 7 | 30;
}): React.ReactElement {
  const { palette, fontMonoRegular, fontSansMedium, width } = useCrewTheme();
  const recordedPoints = useMemo(
    () => points.filter((p): p is TrendPlotPoint & { value: number } => p.value !== null),
    [points],
  );
  const [selectedDay, setSelectedDay] = useState<number | null>(
    recordedPoints.length > 0 ? recordedPoints[recordedPoints.length - 1]!.missionDay : null,
  );

  const chartWidth = Math.max(260, Math.min(width - 68, 620));
  const chartHeight = 186;
  const padLeft = 40;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 32;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;

  const minDay = points[0]?.missionDay ?? 1;
  const maxDay = points[points.length - 1]?.missionDay ?? minDay + (rangeDays - 1);
  const daySpan = Math.max(1, maxDay - minDay);
  const valSpan = Math.max(1, yMax - yMin);

  const xForDay = (day: number) => padLeft + ((day - minDay) / daySpan) * plotWidth;
  const yForVal = (val: number) =>
    padTop + plotHeight - ((val - yMin) / valSpan) * plotHeight;

  // Build line segments ONLY across adjacent non-null consecutive calendar days so gaps stay visibly disconnected!
  const segmentPaths = useMemo(() => {
    const paths: string[] = [];
    let currentPath = '';
    let prevDay: number | null = null;
    for (const pt of points) {
      if (pt.value === null) {
        if (currentPath) {
          paths.push(currentPath);
          currentPath = '';
        }
        prevDay = null;
        continue;
      }
      const x = xForDay(pt.missionDay).toFixed(1);
      const y = yForVal(pt.value).toFixed(1);
      if (prevDay !== null && pt.missionDay === prevDay + 1 && currentPath) {
        currentPath += ` L ${x} ${y}`;
      } else {
        if (currentPath) paths.push(currentPath);
        currentPath = `M ${x} ${y}`;
      }
      prevDay = pt.missionDay;
    }
    if (currentPath) paths.push(currentPath);
    return paths;
  }, [points, minDay, daySpan, yMin, valSpan, plotWidth, plotHeight]);

  const resolvedXTicks = useMemo(() => {
    if (xTickDays && xTickDays.length > 0) return xTickDays;
    if (points.length <= 1) return points.map((p) => p.missionDay);
    const midIndex = Math.floor((points.length - 1) / 2);
    return [points[0]!.missionDay, points[midIndex]!.missionDay, points[points.length - 1]!.missionDay];
  }, [points, xTickDays]);

  const selectedPoint =
    recordedPoints.find((p) => p.missionDay === selectedDay) ??
    recordedPoints[recordedPoints.length - 1] ??
    null;

  const gapCount = points.filter((p) => p.value === null).length;

  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          borderWidth: 1,
          borderColor: palette.borderSubtle,
          borderRadius: palette.radiusControl,
          backgroundColor: palette.surfaceRaised,
          padding: 10,
        }}
        accessible
        accessibilityLabel={`Trend plot covering ${rangeDays} days, ${recordedPoints.length} recorded days and ${gapCount} unrecorded gap days.${
          selectedPoint ? ` Selected Day ${selectedPoint.missionDay}: ${selectedPoint.labelText}.` : ''
        }`}
      >
        <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          {/* Horizontal gridlines + Y ticks */}
          {yTickValues.map((tick) => {
            const y = yForVal(tick);
            return (
              <React.Fragment key={`y-${tick}`}>
                <Line
                  x1={padLeft}
                  y1={y}
                  x2={chartWidth - padRight}
                  y2={y}
                  stroke={palette.borderSubtle}
                  strokeWidth={1}
                />
                <SvgText
                  x={padLeft - 6}
                  y={y + 4}
                  fontSize={11}
                  fill={palette.textSupporting}
                  textAnchor="end"
                  fontFamily={fontMonoRegular}
                >
                  {formatYTick(tick)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* Optional Personal Reference Dashed Line */}
          {referenceValue !== null && referenceValue >= yMin && referenceValue <= yMax ? (
            <Line
              x1={padLeft}
              y1={yForVal(referenceValue)}
              x2={chartWidth - padRight}
              y2={yForVal(referenceValue)}
              stroke={palette.seriesReference}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          ) : null}

          {/* Sparse non-fabricating gap segments */}
          {segmentPaths.map((d, idx) => (
            <Path
              key={`seg-${idx}`}
              d={d}
              fill="none"
              stroke={palette.seriesMeasured}
              strokeWidth={2.2}
            />
          ))}

          {/* Recorded points */}
          {recordedPoints.map((pt) => {
            const cx = xForDay(pt.missionDay);
            const cy = yForVal(pt.value);
            const active = selectedPoint?.missionDay === pt.missionDay;
            return (
              <Circle
                key={`pt-${pt.missionDay}`}
                cx={cx}
                cy={cy}
                r={active ? 5.5 : 3.8}
                fill={active ? palette.focusRing : palette.seriesMeasured}
                stroke={palette.surfacePanel}
                strokeWidth={1.5}
              />
            );
          })}

          {/* X ticks */}
          {resolvedXTicks.map((day) => {
            const x = xForDay(day);
            return (
              <SvgText
                key={`x-${day}`}
                x={x}
                y={chartHeight - 10}
                fontSize={11}
                fill={palette.textSupporting}
                textAnchor="middle"
                fontFamily={fontMonoRegular}
              >
                {`Day ${day}`}
              </SvgText>
            );
          })}
        </Svg>
      </View>

      {/* Legend + Point Inspection Controls (>= 48dp touch targets) */}
      <View style={styles.metaRow}>
        <Text
          style={{
            fontFamily: fontMonoRegular,
            fontSize: 12,
            color: palette.textSupporting,
          }}
        >
          {recordedPoints.length} recorded · {gapCount} gap {gapCount === 1 ? 'day' : 'days'}
          {referenceLabel ? ` · Ref: ${referenceLabel}` : ' · No active reference'}
        </Text>
      </View>

      {recordedPoints.length > 0 ? (
        <View style={styles.pointChips}>
          {recordedPoints.map((pt) => {
            const active = selectedPoint?.missionDay === pt.missionDay;
            return (
              <Pressable
                key={`chip-${pt.missionDay}`}
                onPress={() => setSelectedDay(pt.missionDay)}
                accessibilityRole="button"
                accessibilityLabel={`Day ${pt.missionDay}, ${pt.labelText}`}
                accessibilityState={{ selected: active }}
                style={{
                  minHeight: MIN_NATIVE_TARGET_DP,
                  minWidth: MIN_NATIVE_TARGET_DP,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: palette.radiusControl,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? palette.focusRing : palette.borderSubtle,
                  backgroundColor: active ? palette.selectionBg : palette.surfacePanel,
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: fontSansMedium,
                    fontSize: 12,
                    color: palette.textPrimary,
                  }}
                >
                  {`D${pt.missionDay}: ${pt.labelText}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  pointChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
