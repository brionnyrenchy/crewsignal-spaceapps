import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ActionButton,
  CalmBanner,
  EyebrowLabel,
  PanelCard,
  ScreenTitle,
  SelectableChip,
  StatusBadge,
} from '../components/AppPrimitives';
import { ReadingStatusLegend } from '../components/ReadingStatusBadge';
import { useCrewSignal } from '../state/CrewSignalContext';
import { useCrewTheme } from '../theme/ThemeProvider';

export function HelpScreen(): React.ReactElement {
  const { palette, fontSansMedium, fontSansRegular, fontMonoRegular } = useCrewTheme();
  const {
    helpContent,
    preferences,
    updatePreferences,
    isOfflineSimulated,
    activeDraft,
    goBackFromHelp,
    navigateTo,
  } = useCrewSignal();

  const currentMode = preferences?.helpMode ?? 'unconfigured';

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { backgroundColor: palette.surfaceCanvas }]}
    >
      <ScreenTitle
        title="Help & Procedure Card"
        subtitle="Always reachable offline, before logging data, or mid-check-in without losing your draft"
      />

      {activeDraft ? (
        <CalmBanner
          title="Open check-in preserved"
          message="Returning from Help keeps every field you entered in your uncommitted draft."
          tone="neutral"
          actionLabel="Return to Check-in"
          onAction={() => navigateTo('checkin')}
        />
      ) : null}

      {helpContent.mode === 'configured_fixture' && helpContent.fixtureBanner ? (
        <CalmBanner
          testID="help-fixture-banner"
          title={helpContent.fixtureBanner}
          message="Synthetic demonstration fixture only. Do not confuse fixture contacts with mission flight-surgeon channels."
          tone="review"
        />
      ) : null}

      <ReadingStatusLegend />

      <PanelCard testID="help-procedure-card">
        <View style={{ gap: 12 }}>
          <View style={styles.rowBetween}>
            <EyebrowLabel>Procedure & escalation status</EyebrowLabel>
            <StatusBadge
              label={
                helpContent.mode === 'configured_fixture'
                  ? 'Test fixture'
                  : 'Unconfigured'
              }
              tone={helpContent.mode === 'configured_fixture' ? 'review' : 'neutral'}
            />
          </View>

          <Text
            style={{
              fontFamily: fontSansMedium,
              fontSize: 20,
              color: palette.textPrimary,
            }}
          >
            {helpContent.statusTitle}
          </Text>

          <Text
            style={{
              fontFamily: fontSansRegular,
              fontSize: 15,
              lineHeight: 22,
              color: palette.textBody,
            }}
          >
            {helpContent.body}
          </Text>

          <View style={{ gap: 6 }}>
            <EyebrowLabel>Offline actions on this build</EyebrowLabel>
            {helpContent.steps.map((step, index) => (
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

          <Text
            style={{
              fontFamily: fontSansRegular,
              fontSize: 13,
              lineHeight: 19,
              color: palette.textSupporting,
            }}
          >
            {helpContent.limitation}
          </Text>

          {helpContent.offlineFacts.length > 0 ? (
            <PanelCard raised>
              <View style={{ gap: 4 }}>
                {helpContent.versionLabel ? (
                  <EyebrowLabel>{helpContent.versionLabel}</EyebrowLabel>
                ) : null}
                {helpContent.offlineFacts.map((fact, idx) => (
                  <Text
                    key={idx}
                    style={{
                      fontFamily: fontMonoRegular,
                      fontSize: 12,
                      color: palette.textPrimary,
                    }}
                  >
                    {`· ${fact}`}
                  </Text>
                ))}
              </View>
            </PanelCard>
          ) : null}
        </View>
      </PanelCard>

      <PanelCard>
        <View style={{ gap: 10 }}>
          <EyebrowLabel>Device connectivity & fixture mode</EyebrowLabel>
          <Text
            style={{
              fontFamily: fontSansRegular,
              fontSize: 13,
              lineHeight: 19,
              color: palette.textSupporting,
            }}
          >
            {`Offline local store: ${isOfflineSimulated ? 'Offline mode active (all logging, review, export, and Help work offline)' : 'Local'}. CrewSignal stores data only in the app SQLite database until you choose to export or share.`}
          </Text>

          <View style={styles.rowWrap}>
            <SelectableChip
              testID="help-mode-unconfigured"
              label="Default unconfigured"
              selected={currentMode === 'unconfigured'}
              onPress={() => void updatePreferences({ helpMode: 'unconfigured' })}
            />
            <SelectableChip
              testID="help-mode-fixture"
              label="Test fixture preview"
              selected={currentMode === 'configured_fixture'}
              onPress={() => void updatePreferences({ helpMode: 'configured_fixture' })}
            />
          </View>
        </View>
      </PanelCard>

      <View style={styles.rowWrap}>
        <ActionButton
          testID="help-back-button"
          label="Return to previous screen"
          onPress={goBackFromHelp}
          variant="primary"
        />
        <ActionButton
          label="Open Sources"
          onPress={() => navigateTo('sources')}
          variant="secondary"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 28,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
