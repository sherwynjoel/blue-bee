import React from 'react';
import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme, type TypeVariant } from '../../theme';

export type TextColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'azure'
  | 'honey'
  | 'success'
  | 'warning'
  | 'danger'
  | 'onAzure'
  | 'onHoney';

export interface UITextProps extends TextProps {
  variant?: TypeVariant;
  color?: TextColor;
  /** Tabular figures — for money / counts / ETAs that should align column-wise. */
  tabular?: boolean;
  /** Monospaced + tabular — for IDs / ETAs that read as data. */
  mono?: boolean;
  weight?: TextStyle['fontWeight'];
  center?: boolean;
}

function resolveColor(color: TextColor, c: ReturnType<typeof useTheme>['colors']): string {
  switch (color) {
    case 'primary':
      return c.text;
    case 'secondary':
      return c.textSecondary;
    case 'tertiary':
      return c.textTertiary;
    case 'azure':
      return c.azure;
    // Semantic TEXT uses the legible on-tint foreground (dark in light mode, bright in dark mode) so
    // it passes contrast on canvas/surface/its own pale tint. Bright hues stay for icons/fills/dots.
    case 'honey':
      return c.onHoneyTint;
    case 'success':
      return c.onSuccessTint;
    case 'warning':
      return c.onWarningTint;
    case 'danger':
      return c.onDangerTint;
    case 'onAzure':
      return c.onAzure;
    case 'onHoney':
      return c.onHoney;
  }
}

/**
 * Daylight typographic primitive. Picks size/line-height/weight from the type scale, the color from the
 * theme, and keeps Dynamic Type on (no font-scale cap) for accessibility. Forwards `testID`, `children`,
 * `numberOfLines`, etc. straight to the host `Text` so existing test queries keep working.
 */
export function Text({
  variant = 'body',
  color = 'primary',
  tabular,
  mono,
  weight,
  center,
  style,
  ...rest
}: UITextProps): React.ReactElement {
  const theme = useTheme();
  const base = theme.type[variant];
  const extra: TextStyle = {
    color: resolveColor(color, theme.colors),
    ...(mono ? theme.monoTabular : tabular ? theme.tabular : null),
    ...(weight ? { fontWeight: weight } : null),
    ...(center ? { textAlign: 'center' } : null),
  };
  return <RNText {...rest} style={StyleSheet.flatten([base, extra, style])} />;
}
