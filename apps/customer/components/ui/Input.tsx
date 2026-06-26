import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  /** Error message (red border + helper text). */
  error?: string | null;
  /** Helper text shown under the field when there's no error. */
  hint?: string;
  /** A Feather icon shown at the leading edge. */
  icon?: React.ComponentProps<typeof Feather>['name'];
  containerStyle?: ViewStyle;
}

/**
 * A Daylight text field — label, focus ring (azure), error state, optional leading icon. Forwards
 * `testID` and every TextInput prop straight to the host input so existing test queries keep matching.
 */
export function Input({ label, error, hint, icon, containerStyle, style, onFocus, onBlur, ...rest }: InputProps): React.ReactElement {
  const { colors, radius, type } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.azure : colors.hairline;

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
          },
        ]}
      >
        {icon ? <Feather name={icon} size={18} color={colors.textTertiary} style={styles.icon} /> : null}
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
          style={[styles.input, { color: colors.text, fontSize: type.body.fontSize }, style]}
        />
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

const styles = StyleSheet.create({
  label: { marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 50 },
  icon: { marginRight: 10 },
  input: { flex: 1, paddingVertical: 13 },
  helper: { marginTop: 6 },
});
