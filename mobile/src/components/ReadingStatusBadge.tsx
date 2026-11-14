import React from 'react';
import { Text, View } from 'react-native';
import { READING_STATUSES, READING_STATUS_ORDER, type ReadingStatus } from '../shared/src';
import { useCrewTheme } from '../theme/ThemeProvider';
import { PanelCard } from './AppPrimitives';

export function ReadingStatusBadge({ status }: { status: ReadingStatus }) {
  const { palette, fontSansMedium } = useCrewTheme();
  const { fg, bg } = palette.readingStatus[status];
  const { icon, label } = READING_STATUSES[status];

  return (
    <View style={{
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: palette.radiusBadge,
      backgroundColor: bg,
    }}>
      <Text accessible={false} importantForAccessibility="no" style={{ color: fg, fontSize: 13 }}>
        {icon}
      </Text>
      <Text style={{ color: fg, fontSize: 13, fontFamily: fontSansMedium, flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}

export function ReadingStatusLegend() {
  const { palette, fontSansMedium, fontSansRegular } = useCrewTheme();
  return (
    <PanelCard>
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: palette.textPrimary, fontFamily: fontSansMedium, fontSize: 17 }}>
          Reading status legend
        </Text>
        {READING_STATUS_ORDER.map((status) => (
          <View key={status} style={{ gap: 4 }}>
            <ReadingStatusBadge status={status} />
            <Text style={{ color: palette.textBody, fontFamily: fontSansRegular, fontSize: 13 }}>
              {READING_STATUSES[status].description}
            </Text>
          </View>
        ))}
      </View>
    </PanelCard>
  );
}
