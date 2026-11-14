import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCrewSignal, type CrewSignalRoute } from '../state/CrewSignalContext';
import { useCrewTheme } from '../theme/ThemeProvider';
import { MIN_NATIVE_TARGET_DP } from '../theme/tokens';
import { EyebrowLabel, PanelCard, ScreenTitle } from '../components/AppPrimitives';

interface MoreDestination {
  route: CrewSignalRoute;
  title: string;
  subtitle: string;
}

const DESTINATIONS: readonly MoreDestination[] = [
  {
    route: 'actions',
    title: 'Actions',
    subtitle: 'Sleep & routine guidance linked to your personal reference',
  },
  {
    route: 'reports',
    title: 'Reports',
    subtitle: 'Filtered reports, A4 print, backups, draft recovery & CSV import',
  },
  {
    route: 'sources',
    title: 'Sources',
    subtitle: 'Cached NASA, CDC & NIST reference summaries and external links',
  },
  {
    route: 'settings',
    title: 'Settings',
    subtitle: 'Profiles (Demo/Personal), mission clock, units, appearance & resets',
  },
  {
    route: 'help',
    title: 'Help',
    subtitle: 'Offline procedure card & communication setup status',
  },
];

export function MoreScreen(): React.ReactElement {
  const { palette, fontSansMedium, fontSansRegular } = useCrewTheme();
  const { navigateTo, activeProfile, observations } = useCrewSignal();

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { backgroundColor: palette.surfaceCanvas }]}
    >
      <ScreenTitle
        title="More"
        subtitle={
          activeProfile
            ? `${activeProfile.label} · ${observations.length} committed observations`
            : 'Secondary tools & configuration'
        }
      />

      <PanelCard>
        <View style={{ gap: 8 }}>
          <EyebrowLabel>Destinations</EyebrowLabel>
          {DESTINATIONS.map((dest) => (
            <Pressable
              key={dest.route}
              testID={`more-nav-${dest.route}`}
              onPress={() => navigateTo(dest.route)}
              accessibilityRole="button"
              accessibilityLabel={`${dest.title}. ${dest.subtitle}`}
              style={({ pressed }) => [
                {
                  minHeight: MIN_NATIVE_TARGET_DP,
                  minWidth: MIN_NATIVE_TARGET_DP,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: palette.radiusControl,
                  borderWidth: 1,
                  borderColor: palette.borderSubtle,
                  backgroundColor: palette.surfaceRaised,
                  justifyContent: 'center',
                  gap: 3,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={{
                  fontFamily: fontSansMedium,
                  fontSize: 16,
                  color: palette.textPrimary,
                }}
              >
                {dest.title}
              </Text>
              <Text
                style={{
                  fontFamily: fontSansRegular,
                  fontSize: 13,
                  lineHeight: 18,
                  color: palette.textSupporting,
                }}
              >
                {dest.subtitle}
              </Text>
            </Pressable>
          ))}
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
});
