import React, { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, type TextStyle, View, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, tabular } from './theme';
import { Text } from './Text';

/**
 * A Daylight text field — an azure focus ring, an optional label / error / hint, an optional leading
 * icon, and an optional `big` mode for glove-friendly OTP / weight entry.
 *
 * Reconciles both existing versions (superset, dropping nothing):
 *  - customer's `Input` extended `TextInputProps` (so every native prop — `secureTextEntry`,
 *    `returnKeyType`, `textAlign`, … — forwards straight through) and added `label` / `error` / `hint` /
 *    `icon` / `containerStyle`;
 *  - driver/owner's kit `Input` had a narrower hand-listed prop set PLUS a `big` mode (large tabular
 *    figures for the OTP / weigh screens).
 * The shared version extends `TextInputProps` (covering all of driver/owner's forwarded props) and keeps
 * `label`/`error`/`hint`/`icon`/`containerStyle` AND `big`. The leading icon tints azure on focus /
 * danger on error, matching the border (a harmonious extension of customer's always-tertiary icon).
 */
export interface InputProps extends TextInputProps {
  label?: string;
  /** Error message (danger border + helper text). */
  error?: string | null;
  /** Helper text shown under the field when there's no error. */
  hint?: string;
  /** A leading Feather icon. */
  icon?: React.ComponentProps<typeof Feather>['name'];
  containerStyle?: ViewStyle;
  /** Large, glove-friendly figures (OTP / weight entry) — driver/owner's capability. */
  big?: boolean;
  /** A trailing unit/affix (e.g. "kg", "sqft") rendered inside the field after the input. */
  suffix?: string;
}

export function Input({
  label,
  error,
  hint,
  icon,
  containerStyle,
  big,
  suffix,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps): React.ReactElement {
  const { colors, radius, type } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.azure : colors.hairline;
  const iconColor = error ? colors.danger : focused ? colors.azure : colors.textTertiary;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="subhead" weight="500" color="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor,
            borderRadius: radius.input,
            borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth,
            minHeight: big ? 56 : 50,
          },
        ]}
      >
        {icon ? <Feather name={icon} size={18} color={iconColor} style={styles.icon} /> : null}
        <TextInput
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.input,
            { color: colors.text, fontSize: type.body.fontSize },
            big ? [styles.big, tabular] : null,
            style,
          ]}
        />
        {suffix ? (
          <Text variant="subhead" weight="600" color="secondary" style={styles.suffix}>
            {suffix}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Text variant="footnote" color="danger" style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" color="tertiary" style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const bigFigures: TextStyle = { fontSize: 26, fontWeight: '700', letterSpacing: 6 };

const styles = StyleSheet.create({
  label: { marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  icon: { marginRight: 10 },
  suffix: { marginLeft: 8 },
  input: { flex: 1, paddingVertical: 13 },
  big: bigFigures,
  helper: { marginTop: 6 },
});
