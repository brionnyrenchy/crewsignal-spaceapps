import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ACTION_CONTENT_LIST,
  EVIDENCE_REGISTRY,
  METRIC_DEFINITIONS,
  buildSleepInsight,
  getLatestObservationsByMetric,
  isInsightReviewCurrent,
  resolveActiveReference,
  type MetricId,
} from '../shared/src';
import {
  ActionButton,
  CalmBanner,
  EyebrowLabel,
  PanelCard,
  ScreenTitle,
  SelectableChip,
  StatusBadge,
} from '../components/AppPrimitives';
import { useCrewSignal } from '../state/CrewSignalContext';
import { useCrewTheme } from '../theme/ThemeProvider';

const ACTION_QUICK_METRIC: Record<string, MetricId | undefined> = {
  'action-review-sleep-routine': 'sleep',
  'action-check-measurement-context': 'blood_pressure',
};

export function ActionsScreen(): React.ReactElement {
  const { palette, fontSansMedium, fontSansRegular, fontMonoRegular } = useCrewTheme();
  const {
    activeProfile,
    observations,
    references,
    insights,
    selectedActionId,
    setSelectedActionId,
    reviewInsight,
    navigateTo,
    startOrResumeCheckIn,
    nowUtc,
  } = useCrewSignal();

  const latestByMetric = useMemo(
    () => getLatestObservationsByMetric(observations),
    [observations],
  );

  const sleepInsight = useMemo(() => {
    if (!activeProfile) return null;
    const latestSleep = latestByMetric.sleep;
    if (!latestSleep) return null;
    const sleepRef = resolveActiveReference({
      profileId: activeProfile.profileId,
      metricId: 'sleep',
      references,
      observations,
      nowUtc: nowUtc(),
    });
    const reviewedIds = new Set(
      insights.filter((i) => i.status === 'reviewed').map((i) => i.observationId),
    );
    return buildSleepInsight({
      observation: latestSleep,
      reference: sleepRef,
      createdAtUtc: nowUtc(),
      reviewedObservationIds: reviewedIds,
    });
  }, [activeProfile, insights, latestByMetric.sleep, nowUtc, observations, references]);

  const savedSleepInsight = useMemo(() => {
    if (!sleepInsight) return null;
    const saved = insights.find(
      (i) => i.insightId === sleepInsight.insightId && i.observationId === sleepInsight.observationId,
    );
    return saved ?? null;
  }, [insights, sleepInsight]);

  if (!activeProfile) {
    return (
      <View style={styles.center}>
        <Text style={{ fontFamily: fontSansRegular, color: palette.textSupporting }}>
          Loading Actions…
        </Text>
      </View>
    );
  }

  const sleepReviewed =
    savedSleepInsight && sleepInsight
      ? isInsightReviewCurrent(savedSleepInsight, sleepInsight)
      : sleepInsight?.status === 'reviewed';

  const displayedInsight = savedSleepInsight ?? sleepInsight;

  const selectedContent =
    ACTION_CONTENT_LIST.find((a) => a.actionId === selectedActionId) ?? ACTION_CONTENT_LIST[0]!;
  const quickMetricId = ACTION_QUICK_METRIC[selectedContent.actionId];

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { backgroundColor: palette.surfaceCanvas }]}
    >
      <ScreenTitle
        title="Actions"
        subtitle="Non-diagnostic mission habits & reference-linked sleep guidance"
      />

      {displayedInsight ? (
        <PanelCard testID="actions-sleep-insight-card">
          <View style={{ gap: 10 }}>
            <View style={styles.rowBetween}>
              <StatusBadge
                label={sleepReviewed ? 'Reviewed' : 'Review'}
                tone={sleepReviewed ? 'neutral' : 'review'}
              />
              <Text
                style={{
                  fontFamily: fontMonoRegular,
                  fontSize: 11,
                  color: palette.textSupporting,
                }}
              >
                {`${displayedInsight.ruleId} · v${displayedInsight.ruleVersion}`}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: fontSansMedium,
                fontSize: 18,
                color: palette.textPrimary,
              }}
            >
              {displayedInsight.summary}
            </Text>
            <Text
              style={{
                fontFamily: fontSansRegular,
                fontSize: 14,
                lineHeight: 21,
                color: palette.textBody,
              }}
            >
              {displayedInsight.differenceText}
            </Text>
            <View style={styles.rowWrap}>
              {!sleepReviewed ? (
                <ActionButton
                  label="Mark reviewed"
                  onPress={() => void reviewInsight(displayedInsight)}
                  variant="primary"
                />
              ) : null}
              <ActionButton
                label="View sources"
                onPress={() => navigateTo('sources')}
                variant="secondary"
              />
            </View>
          </View>
        </PanelCard>
      ) : (
        <CalmBanner
          title="No active sleep review trigger"
          message="Guidance activates only when logged observations fall meaningfully below your active personal reference."
          tone="neutral"
          actionLabel="Log Sleep"
          onAction={() => startOrResumeCheckIn('sleep')}
        />
      )}

      <View style={{ gap: 6 }}>
        <EyebrowLabel>Offline indicator guidance</EyebrowLabel>
        <View style={styles.rowWrap}>
          {ACTION_CONTENT_LIST.map((item) => (
            <SelectableChip
              key={item.actionId}
              label={item.badgeLabel}
              selected={selectedContent.actionId === item.actionId}
              onPress={() => setSelectedActionId(item.actionId)}
            />
          ))}
        </View>
      </View>

      <PanelCard testID="actions-detail-card">
        <View style={{ gap: 12 }}>
          <View style={styles.rowBetween}>
            <EyebrowLabel>{selectedContent.badgeLabel}</EyebrowLabel>
            <StatusBadge
              label={selectedContent.enabled ? 'Available offline' : 'Disabled · unreviewed'}
              tone={selectedContent.enabled ? 'neutral' : 'review'}
            />
          </View>
          <Text
            style={{
              fontFamily: fontSansMedium,
              fontSize: 18,
              color: palette.textPrimary,
            }}
          >
            {selectedContent.title}
          </Text>
          <Text
            style={{
              fontFamily: fontSansRegular,
              fontSize: 14,
              lineHeight: 20,
              color: palette.textBody,
            }}
          >
            {selectedContent.triggerSummary}
          </Text>

          {selectedContent.disabledReason ? (
            <CalmBanner
              title="Guidance disabled pending mission review"
              message={selectedContent.disabledReason}
              tone="review"
            />
          ) : null}

          <View style={{ gap: 4 }}>
            <EyebrowLabel>Applicability & limitation</EyebrowLabel>
            <Text
              style={{
                fontFamily: fontSansRegular,
                fontSize: 13,
                lineHeight: 19,
                color: palette.textSupporting,
              }}
            >
              {`${selectedContent.applicability} · ${selectedContent.limitation}`}
            </Text>
          </View>

          <View style={{ gap: 6 }}>
            <EyebrowLabel>Suggested offline steps</EyebrowLabel>
            {selectedContent.steps.map((step, index) => (
              <Text
                key={index}
                style={{
                  fontFamily: fontSansRegular,
                  fontSize: 14,
                  lineHeight: 20,
                  color: palette.textBody,
                }}
              >
                {`${index + 1}. ${step}`}
              </Text>
            ))}
          </View>

          {selectedContent.sourceIds.length > 0 ? (
            <View style={{ gap: 6 }}>
              <EyebrowLabel>Cached evidence references</EyebrowLabel>
              {selectedContent.sourceIds.map((srcId) => {
                const ev = EVIDENCE_REGISTRY[srcId];
                if (!ev) return null;
                return (
                  <Text
                    key={srcId}
                    style={{
                      fontFamily: fontMonoRegular,
                      fontSize: 12,
                      color: palette.textSupporting,
                    }}
                  >
                    {`· ${ev.title} (${ev.publisher})`}
                  </Text>
                );
              })}
            </View>
          ) : null}

          <View style={styles.rowWrap}>
            <ActionButton
              label="Open Sources & URLs"
              onPress={() => navigateTo('sources')}
              variant="secondary"
            />
            {quickMetricId ? (
              <ActionButton
                label={`Record ${METRIC_DEFINITIONS[quickMetricId].shortLabel}`}
                onPress={() => startOrResumeCheckIn(quickMetricId)}
                variant="subtle"
              />
            ) : null}
          </View>
        </View>
      </PanelCard>
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
