import React from 'react';
import { StyleSheet, Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type ThemeColors, type TypeVariant } from './theme';

/**
 * Daylight typographic primitive — the shared `Text`.
 *
 * Reconciles the two existing versions (superset, never dropping a capability):
 *  - customer's `Text` took a SEMANTIC `color` name ('primary' | 'secondary' | 'success' | …) resolved
 *    through the theme;
 *  - driver/owner's kit `Text` took a RAW color string (e.g. `color={t.colors.text}`).
 * The shared version accepts BOTH: a known semantic name is mapped through the theme, anything else is
 * treated as a raw color string. It extends RN's `TextProps`, so `testID`, `numberOfLines`, `children`,
 * `accessibilityRole`, etc. forward straight to the host `Text` and existing test queries keep working.
 *
 * (Pulled forward from Task 3 because `Button` depends on it; Task 3 verifies/extends this file rather
 * than building `Text` from scratch.)
 */

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

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  /** A semantic color name (mapped through the theme) OR a raw color string (driver/owner's pattern). */
  color?: TextColor | string;
  /** Tabular figures — for money / counts / ETAs that should align column-wise. */
  tabular?: boolean;
  /** Monospaced + tabular — for IDs / ETAs that read as data. */
  mono?: boolean;
  weight?: TextStyle['fontWeight'];
  center?: boolean;
}

function resolveColor(color: string, c: ThemeColors): string {
  switch (color) {
    case 'primary':
      return c.text;
    case 'secondary':
      return c.textSecondary;
    case 'tertiary':
      return c.textTertiary;
    case 'azure':
      return c.azure;
    // Semantic TEXT uses the legible on-tint foreground (dark in light mode, bright in dark mode) so it
    // passes contrast on canvas/surface/its own pale tint. Bright hues stay for icons/fills/dots.
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
    default:
      // Not a semantic name → a raw color string (driver/owner pass theme hex values directly).
      return color;
  }
}

export function Text({
  variant = 'body',
  color = 'primary',
  tabular: tab,
  mono,
  weight,
  center,
  style,
  ...rest
}: TextProps): React.ReactElement {
  const theme = useTheme();
  const base = theme.type[variant];
  const extra: TextStyle = {
    color: resolveColor(color, theme.colors),
    ...(mono ? theme.monoTabular : tab ? theme.tabular : null),
    ...(weight ? { fontWeight: weight } : null),
    ...(center ? { textAlign: 'center' } : null),
  };
  return <RNText {...rest} style={StyleSheet.flatten([base, extra, style])} />;
}
