import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useCrewTheme } from '../theme/ThemeProvider';
import { MIN_NATIVE_TARGET_DP } from '../theme/tokens';

export function PanelCard({
  children,
  style,
  raised = false,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
  testID?: string;
}): React.ReactElement {
  const { palette } = useCrewTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: raised ? palette.surfaceRaised : palette.surfacePanel,
          borderRadius: palette.radiusCard,
          borderWidth: 1,
          borderColor: palette.borderSubtle,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function EyebrowLabel({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { palette, fontMonoRegular, resolvedMode } = useCrewTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fontMonoRegular,
          fontSize: 12,
          lineHeight: 16,
          letterSpacing: resolvedMode === 'light' ? 0.85 : 0.4,
          textTransform: 'uppercase',
          color: palette.textSupporting,
        },
        style as never,
      ]}
    >
      {children}
    </Text>
  );
}

export function ScreenTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.ReactElement {
  const { palette, fontSansMedium, fontSansRegular, resolvedMode } = useCrewTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text
        accessibilityRole="header"
        style={{
          fontFamily: fontSansMedium,
          fontSize: resolvedMode === 'light' ? 28 : 30,
          lineHeight: 34,
          letterSpacing: resolvedMode === 'light' ? -0.9 : -0.5,
          color: palette.textPrimary,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontFamily: fontSansRegular,
            fontSize: 14,
            lineHeight: 20,
            color: palette.textSupporting,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export type BadgeTone = 'neutral' | 'review' | 'confirmed' | 'danger';

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: BadgeTone;
}): React.ReactElement {
  const { palette, fontMonoMedium, resolvedMode } = useCrewTheme();

  let bg = palette.surfaceRaised;
  let fg = palette.textBody;
  let border = palette.borderSubtle;

  if (tone === 'review') {
    // Light mode strictly uses neutral monochrome pill (#f0f0f0 / #171717); Dark uses warm subtle review pill.
    bg = palette.reviewBadgeBg;
    fg = palette.reviewFg;
    border = resolvedMode === 'light' ? palette.borderSubtle : '#4d3e22';
  } else if (tone === 'confirmed') {
    bg = resolvedMode === 'light' ? '#eef8f0' : '#122619';
    fg = palette.confirmationFg;
    border = resolvedMode === 'light' ? '#cce8d1' : '#245232';
  } else if (tone === 'danger') {
    bg = palette.dangerBg;
    fg = palette.dangerFg;
    border = palette.dangerBorder;
  }

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: bg,
        borderColor: border,
        borderWidth: 1,
        borderRadius: palette.radiusBadge,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <Text
        style={{
          fontFamily: fontMonoMedium,
          fontSize: 11,
          lineHeight: 15,
          letterSpacing: resolvedMode === 'light' ? 0.6 : 0.2,
          color: fg,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  fullWidth = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'subtle' | 'danger';
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  fullWidth?: boolean;
}): React.ReactElement {
  const { palette, fontSansMedium } = useCrewTheme();
  const [focused, setFocused] = useState(false);

  let backgroundColor = palette.actionPrimaryBg;
  let textColor = palette.actionPrimaryFg;
  let borderColor = palette.actionPrimaryBg;

  if (variant === 'secondary') {
    backgroundColor = palette.surfaceRaised;
    textColor = palette.textPrimary;
    borderColor = palette.borderControl;
  } else if (variant === 'subtle') {
    backgroundColor = 'transparent';
    textColor = palette.textBody;
    borderColor = palette.borderSubtle;
  } else if (variant === 'danger') {
    backgroundColor = palette.dangerBg;
    textColor = palette.dangerFg;
    borderColor = palette.dangerBorder;
  }

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          minHeight: MIN_NATIVE_TARGET_DP,
          minWidth: MIN_NATIVE_TARGET_DP,
          paddingHorizontal: 16,
          paddingVertical: 11,
          borderRadius: palette.radiusControl,
          backgroundColor,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? palette.focusRing : borderColor,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: disabled ? 0.52 : pressed ? 0.85 : 1,
          width: fullWidth ? '100%' : undefined,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fontSansMedium,
          fontSize: 15,
          lineHeight: 20,
          color: textColor,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export type LabeledFieldInputRef = React.ComponentRef<typeof TextInput>;

export interface LabeledFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  helperText?: string;
  errorText?: string | null;
  unitLabel?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  inputRef?: React.Ref<LabeledFieldInputRef>;
  accessibilityLabel?: string;
  testID?: string;
  editable?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
}

export function LabeledField({
  label,
  value,
  onChangeText,
  placeholder,
  helperText,
  errorText,
  unitLabel,
  keyboardType = 'default',
  multiline = false,
  inputRef,
  accessibilityLabel,
  testID,
  editable = true,
  autoCapitalize = 'sentences',
}: LabeledFieldProps): React.ReactElement {
  const { palette, fontSansMedium, fontSansRegular, fontMonoRegular } = useCrewTheme();
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(errorText);

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.fieldLabelRow}>
        <Text
          style={{
            fontFamily: fontSansMedium,
            fontSize: 14,
            lineHeight: 20,
            color: palette.textPrimary,
            flexShrink: 1,
          }}
        >
          {label}
        </Text>
        {unitLabel ? (
          <Text
            style={{
              fontFamily: fontMonoRegular,
              fontSize: 12,
              lineHeight: 16,
              color: palette.textSupporting,
            }}
          >
            {unitLabel}
          </Text>
        ) : null}
      </View>

      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={palette.textSupporting}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={accessibilityLabel ?? (unitLabel ? `${label} (${unitLabel})` : label)}
        style={{
          minHeight: multiline ? 88 : MIN_NATIVE_TARGET_DP,
          borderRadius: palette.radiusControl,
          borderWidth: focused || hasError ? 2 : 1,
          borderColor: hasError
            ? palette.dangerFg
            : focused
              ? palette.focusRing
              : palette.borderControl,
          backgroundColor: palette.surfaceRaised,
          color: palette.textPrimary,
          fontFamily: fontSansRegular,
          fontSize: 16,
          lineHeight: 22,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 10,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />

      {hasError ? (
        <Text
          accessibilityRole="alert"
          style={{
            fontFamily: fontSansMedium,
            fontSize: 13,
            lineHeight: 18,
            color: palette.dangerFg,
          }}
        >
          {errorText}
        </Text>
      ) : helperText ? (
        <Text
          style={{
            fontFamily: fontSansRegular,
            fontSize: 13,
            lineHeight: 18,
            color: palette.textSupporting,
          }}
        >
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

export function SelectableChip({
  label,
  selected,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}): React.ReactElement {
  const { palette, fontSansMedium } = useCrewTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        {
          minHeight: MIN_NATIVE_TARGET_DP,
          minWidth: MIN_NATIVE_TARGET_DP,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: palette.radiusControl,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? palette.focusRing : palette.borderControl,
          backgroundColor: selected ? palette.selectionBg : palette.surfacePanel,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fontSansMedium,
          fontSize: 14,
          lineHeight: 18,
          color: palette.textPrimary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function CalmBanner({
  title,
  message,
  tone = 'neutral',
  actionLabel,
  onAction,
  testID,
}: {
  title: string;
  message: string;
  tone?: BadgeTone;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}): React.ReactElement {
  const { palette, fontSansMedium, fontSansRegular, resolvedMode } = useCrewTheme();

  let bg = palette.surfaceRaised;
  let border = palette.borderSubtle;
  let titleColor = palette.textPrimary;

  if (tone === 'confirmed') {
    bg = resolvedMode === 'light' ? '#eef8f0' : '#102216';
    border = resolvedMode === 'light' ? '#cce8d1' : '#245232';
    titleColor = palette.confirmationFg;
  } else if (tone === 'danger') {
    bg = palette.dangerBg;
    border = palette.dangerBorder;
    titleColor = palette.dangerFg;
  } else if (tone === 'review') {
    bg = palette.reviewBadgeBg;
    border = resolvedMode === 'light' ? palette.borderSubtle : '#4d3e22';
    titleColor = palette.reviewFg;
  }

  return (
    <View
      testID={testID}
      style={{
        backgroundColor: bg,
        borderColor: border,
        borderWidth: 1,
        borderRadius: palette.radiusCard,
        padding: 14,
        gap: 8,
      }}
    >
      <Text
        style={{
          fontFamily: fontSansMedium,
          fontSize: 15,
          lineHeight: 20,
          color: titleColor,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily: fontSansRegular,
          fontSize: 14,
          lineHeight: 20,
          color: palette.textBody,
        }}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <View style={{ alignSelf: 'flex-start', marginTop: 2 }}>
          <ActionButton
            label={actionLabel}
            onPress={onAction}
            variant="secondary"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
});
