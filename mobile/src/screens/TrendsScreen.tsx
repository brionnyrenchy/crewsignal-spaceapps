import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  METRIC_DEFINITIONS,
  METRIC_ORDER,
  compareObservationToReference,
  evaluateMetricSchedule,
  getLatestObservationsByMetric,
  getReadingStatus,
  computeMissionDay,
  convertGlucose,
  convertTemperature,
  formatDurationHoursMinutes,
  formatObservationDisplay,
  formatUtcTimeHHMM,
  getObservationSortTimestampMs,
  getObservedMissionDay,
  resolveActiveReference,
  type AppPreferences,
  type Observation,
  type PersonalReference,
} from '../shared/src';
import { ReadingStatusBadge } from '../components/ReadingStatusBadge';
import {
  ActionButton,
  CalmBanner,
  EyebrowLabel,
  PanelCard,
  ScreenTitle,
  SelectableChip,
  StatusBadge,
} from '../components/AppPrimitives';
import { SleepChartSvg, type TrendPlotPoint } from '../components/SleepChartSvg';
import { useCrewSignal } from '../state/CrewSignalContext';
import { useCrewTheme } from '../theme/ThemeProvider';

function extractNumericPlotValue(
  obs: Observation,
  displayUnits: AppPreferences['displayUnits'],
): number {
  switch (obs.canonical.kind) {
    case 'sleep_duration':
      return Number((obs.canonical.durationMinutes / 60).toFixed(2));
    case 'blood_pressure':
      return obs.canonical.systolic;
    case 'mood_ordinal':
      return obs.canonical.score;
    case 'scalar':
      if (obs.metricId === 'blood_glucose') {
        return displayUnits.blood_glucose === 'mmol/L'
          ? Number(convertGlucose(obs.canonical.value, 'mg/dL', 'mmol/L').rounded1.toFixed(1))
          : Math.round(obs.canonical.value);
      }
      if (obs.metricId === 'body_temperature') {
        return displayUnits.body_temperature === 'F'
          ? Number(convertTemperature(obs.canonical.value, 'C', 'F').rounded1.toFixed(1))
          : Number(obs.canonical.value.toFixed(1));
      }
      return obs.canonical.value;
  }
}

function referenceDisplaySummary(
  reference: PersonalReference | null,
  displayUnits: AppPreferences['displayUnits'],
): { plotVal: number | null; text: string | null; provenance: string } {
  if (!reference || !reference.value) {
    return {
      plotVal: null,
      text: null,
      provenance:
        reference?.unavailableReason ??
        'No personal baseline or 7-day history yet (no generic normal range is substituted).',
    };
  }

  const provenance = `${reference.label} · ${reference.method} (${reference.context})`;
  const rv = reference.value;

  if (rv.kind === 'sleep_duration') {
    return {
      plotVal: Number((rv.durationMinutes / 60).toFixed(2)),
      text: formatDurationHoursMinutes(rv.durationMinutes, { padMinutes: true }),
      provenance,
    };
  }
  if (rv.kind === 'blood_pressure') {
    return {
      plotVal: rv.systolic,
      text: `${rv.systolic}/${rv.diastolic} mmHg`,
      provenance,
    };
  }
  if (reference.metricId === 'blood_glucose') {
    const val =
      displayUnits.blood_glucose === 'mmol/L'
        ? Number(convertGlucose(rv.value, 'mg/dL', 'mmol/L').rounded1.toFixed(1))
        : Math.round(rv.value);
    return {
      plotVal: val,
      text: `${val} ${displayUnits.blood_glucose}`,
      provenance,
    };
  }
  if (reference.metricId === 'body_temperature') {
    const val =
      displayUnits.body_temperature === 'F'
        ? Number(convertTemperature(rv.value, 'C', 'F').rounded1.toFixed(1))
        : Number(rv.value.toFixed(1));
    return {
      plotVal: val,
      text: `${val} ${displayUnits.body_temperature === 'F' ? '°F' : '°C'}`,
      provenance,
    };
  }
  return {
    plotVal: rv.value,
    text: `${rv.value} ${reference.unit}`,
    provenance,
  };
}

export function TrendsScreen(): React.ReactElement {
  const { palette, fontSansMedium, fontSansRegular, fontMonoRegular } = useCrewTheme();
  const {
    activeProfile,
    preferences,
    observations,
    references,
    selectedTrendsMetric,
    setSelectedTrendsMetric,
    trendsRangeDays,
    setTrendsRangeDays,
    nowUtc,
    navigateTo,
    startOrResumeCheckIn,
  } = useCrewSignal();

  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  const currentUtc = nowUtc();
  const def = METRIC_DEFINITIONS[selectedTrendsMetric];
  const metricObservations = useMemo(
    () =>
      observations
        .filter((o) => o.metricId === selectedTrendsMetric)
        .sort((a, b) => getObservationSortTimestampMs(a) - getObservationSortTimestampMs(b)),
    [observations, selectedTrendsMetric],
  );

  const latestMetricObs = getLatestObservationsByMetric(metricObservations)[selectedTrendsMetric];

  const activeReference = useMemo(() => {
    if (!activeProfile) return null;
    return resolveActiveReference({
      profileId: activeProfile.profileId,
      metricId: selectedTrendsMetric,
      references,
      observations,
      nowUtc: currentUtc,
    });
  }, [
    activeProfile,
    currentUtc,
    latestMetricObs?.context,
    latestMetricObs?.method,
    observations,
    references,
    selectedTrendsMetric,
  ]);

  const refDisplay = useMemo(
    () =>
      preferences
        ? referenceDisplaySummary(activeReference, preferences.displayUnits)
        : { plotVal: null, text: null, provenance: '' },
    [activeReference, preferences],
  );

  const anchorDay = useMemo(() => {
    if (!activeProfile) return 1;
    const currentDay = computeMissionDay(currentUtc, activeProfile.missionEpochUtc);
    const maxObsDay =
      metricObservations.length > 0
        ? Math.max(...metricObservations.map((o) => getObservedMissionDay(o)))
        : currentDay;
    return Math.max(currentDay, maxObsDay);
  }, [activeProfile, currentUtc, metricObservations]);

  const startDay = Math.max(1, anchorDay - (trendsRangeDays - 1));

  const plotPoints = useMemo<TrendPlotPoint[]>(() => {
    if (!preferences) return [];
    const latestPerDay = new Map<number, Observation>();
    for (const obs of metricObservations) {
      latestPerDay.set(getObservedMissionDay(obs), obs);
    }

    const pts: TrendPlotPoint[] = [];
    for (let day = startDay; day <= anchorDay; day += 1) {
      const obs = latestPerDay.get(day);
      if (!obs) {
        pts.push({
          missionDay: day,
          value: null,
          labelText: 'No entry',
        });
      } else {
        const formatted = formatObservationDisplay(obs, preferences.displayUnits);
        pts.push({
          missionDay: day,
          value: extractNumericPlotValue(obs, preferences.displayUnits),
          labelText: formatted.primaryText,
        });
      }
    }
    return pts;
  }, [anchorDay, metricObservations, preferences, startDay]);

  const domainConfig = useMemo(() => {
    if (selectedTrendsMetric === 'sleep') {
      return {
        yMin: 0,
        yMax: 10,
        yTicks: [0, 5, 10],
        formatTick: (v: number) => `${v}h`,
      };
    }
    if (selectedTrendsMetric === 'mood') {
      return {
        yMin: 1,
        yMax: 5,
        yTicks: [1, 3, 5],
        formatTick: (v: number) => `${v}`,
      };
    }
    const vals = plotPoints
      .map((p) => p.value)
      .filter((v): v is number => v !== null);
    if (refDisplay.plotVal !== null) vals.push(refDisplay.plotVal);
    if (vals.length === 0) {
      return {
        yMin: 0,
        yMax: 100,
        yTicks: [0, 50, 100],
        formatTick: (v: number) => `${v}`,
      };
    }
    const min = Math.floor(Math.min(...vals) - 2);
    const max = Math.ceil(Math.max(...vals) + 2);
    const mid = Math.round((min + max) / 2);
    return {
      yMin: min,
      yMax: Math.max(min + 2, max),
      yTicks: [min, mid, Math.max(min + 2, max)],
      formatTick: (v: number) => `${v}`,
    };
  }, [plotPoints, refDisplay.plotVal, selectedTrendsMetric]);

  const xTicks = useMemo(() => {
    if (trendsRangeDays === 7) {
      return [startDay, Math.round((startDay + anchorDay) / 2), anchorDay];
    }
    return [startDay, startDay + 14, anchorDay];
  }, [anchorDay, startDay, trendsRangeDays]);

  const tableRows = useMemo(
    () => [...metricObservations].reverse(),
    [metricObservations],
  );

  if (!activeProfile || !preferences) {
    return (
      <View style={styles.center}>
        <Text style={{ fontFamily: fontSansRegular, color: palette.textSupporting }}>
          Loading Trends…
        </Text>
      </View>
    );
  }

  const comparison = latestMetricObs ? compareObservationToReference(latestMetricObs, activeReference) : null;
  const status = getReadingStatus(latestMetricObs, comparison, evaluateMetricSchedule({
    metricId: selectedTrendsMetric,
    latestObservation: latestMetricObs,
    schedule: activeProfile.schedules[selectedTrendsMetric],
    referenceNowUtc: currentUtc,
  }));

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { backgroundColor: palette.surfaceCanvas }]}
    >
      <ScreenTitle
        title="Trends"
        subtitle="Sparse history preserves unrecorded days without inventing zero bars"
      />

      {/* Metric Tabs */}
      <View style={styles.rowWrap}>
        {METRIC_ORDER.map((metricId) => (
          <SelectableChip
            key={metricId}
            testID={`trends-metric-${metricId}`}
            label={METRIC_DEFINITIONS[metricId].shortLabel}
            selected={selectedTrendsMetric === metricId}
            onPress={() => setSelectedTrendsMetric(metricId)}
          />
        ))}
      </View>

      {/* Range & Chart/Table Toggles */}
      <View style={styles.rowWrap}>
        <EyebrowLabel>{`Latest ${def.shortLabel.toLowerCase()} reading`}</EyebrowLabel>
        <ReadingStatusBadge status={status} />
      </View>

      <View style={styles.rowBetween}>
        <View style={styles.rowWrap}>
          <SelectableChip
            testID="trends-range-7d"
            label="7 days"
            selected={trendsRangeDays === 7}
            onPress={() => setTrendsRangeDays(7)}
          />
          <SelectableChip
            testID="trends-range-30d"
            label="30 days"
            selected={trendsRangeDays === 30}
            onPress={() => setTrendsRangeDays(30)}
          />
        </View>

        <View style={styles.rowWrap}>
          <SelectableChip
            testID="trends-mode-chart"
            label="Chart"
            selected={viewMode === 'chart'}
            onPress={() => setViewMode('chart')}
          />
          <SelectableChip
            testID="trends-mode-table"
            label="Data table"
            selected={viewMode === 'table'}
            onPress={() => setViewMode('table')}
          />
        </View>
      </View>

      {/* Reference Provenance */}
      <PanelCard>
        <View style={{ gap: 6 }}>
          <View style={styles.rowBetween}>
            <EyebrowLabel>{`${def.name} personal reference`}</EyebrowLabel>
            <ActionButton
              label="View reference"
              onPress={() => navigateTo('settings')}
              variant="subtle"
            />
          </View>
          <Text
            style={{
              fontFamily: fontSansMedium,
              fontSize: 16,
              color: palette.textPrimary,
            }}
          >
            {refDisplay.text ?? 'No active reference'}
          </Text>
          <Text
            style={{
              fontFamily: fontSansRegular,
              fontSize: 13,
              lineHeight: 19,
              color: palette.textSupporting,
            }}
          >
            {refDisplay.provenance}
          </Text>
        </View>
      </PanelCard>

      {metricObservations.length === 0 ? (
        <CalmBanner
          testID="trends-empty-banner"
          title={`No ${def.name.toLowerCase()} entries yet`}
          message="No generic population average or fabricated timeline is plotted until you record an entry."
          tone="neutral"
          actionLabel={`Log ${def.shortLabel}`}
          onAction={() => startOrResumeCheckIn(selectedTrendsMetric)}
        />
      ) : viewMode === 'chart' ? (
        <PanelCard testID="trends-chart-panel">
          <View style={{ gap: 10 }}>
            <EyebrowLabel>{`${def.name} · Days ${startDay}–${anchorDay}`}</EyebrowLabel>
            <SleepChartSvg
              points={plotPoints}
              referenceValue={refDisplay.plotVal}
              referenceLabel={refDisplay.text}
              yMin={domainConfig.yMin}
              yMax={domainConfig.yMax}
              yTickValues={domainConfig.yTicks}
              formatYTick={domainConfig.formatTick}
              xTickDays={xTicks}
              rangeDays={trendsRangeDays}
            />
          </View>
        </PanelCard>
      ) : (
        <PanelCard testID="trends-table-panel">
          <View style={{ gap: 10 }}>
            <EyebrowLabel>{`Data table · ${tableRows.length} recorded observations`}</EyebrowLabel>
            {tableRows.map((obs) => {
              const formatted = formatObservationDisplay(obs, preferences.displayUnits);
              const day = getObservedMissionDay(obs);
              const time =
                obs.timing.kind === 'instant'
                  ? formatUtcTimeHHMM(obs.timing.observedAtUtc)
                  : `${formatUtcTimeHHMM(obs.timing.reportedAtUtc)} (reported)`;
              const comp = compareObservationToReference(obs, activeReference);

              return (
                <View
                  key={obs.observationId}
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: palette.borderSubtle,
                    paddingTop: 10,
                    gap: 4,
                  }}
                >
                  <View style={styles.rowBetween}>
                    <Text
                      style={{
                        fontFamily: fontSansMedium,
                        fontSize: 16,
                        color: palette.textPrimary,
                      }}
                    >
                      {formatted.primaryText}
                    </Text>
                    <Text
                      style={{
                        fontFamily: fontMonoRegular,
                        fontSize: 11,
                        color: palette.textSupporting,
                      }}
                    >
                      {`Day ${day} · ${time}`}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: fontSansRegular,
                      fontSize: 13,
                      color: palette.textSupporting,
                    }}
                  >
                    {`${obs.method} · ${obs.context} · ${
                      comp.comparisonAvailable
                        ? comp.differenceText
                        : comp.unavailableReason
                          ? 'Comparison unavailable'
                          : 'No reference'
                    }`}
                  </Text>
                  {obs.correctionHistory.length > 0 ? (
                    <StatusBadge
                      label={`Corrected (${obs.correctionHistory.length} revision)`}
                      tone="neutral"
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </PanelCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 28,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
