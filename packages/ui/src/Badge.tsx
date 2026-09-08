import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, toneColors, type Tone } from './theme';
import { Text } from './Text';

/**
 * A small status pill — a tinted fill with a legible on-tint label, an optional leading status dot
 * (the bright tone hue) and an optional leading icon.
 *
 * Reconciles both existing versions (superset, dropping nothing):
 *  - customer's `Badge` took a `label` string + `testID`, over the 6-tone set (azure/success/warning/
 *    danger/honey/neutral);
 *  - driver/owner's kit `Badge` took `children` (ReactNode) + an `icon` (Feather) over the same tone set.
 * The shared version accepts BOTH content forms (`children` wins over `label`) and keeps `icon`. Colours
 * resolve through the shared `toneColors()` helper (bg = tint, label/icon = on-tint ink, dot = solid hue).
 */
export type BadgeTone = Tone;

export interface BadgeProps {
  /** Pill text (customer's API). Provide either `label` or `children` — `children` wins if both are given. */
  label?: string;
  children?: React.ReactNode;
  tone?: BadgeTone;
  /** Show a leading status dot in the bright tone hue. */
  dot?: boolean;
  /** A leading Feather icon (driver/owner's capability). */
  icon?: React.ComponentProps<typeof Feather>['name'];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, children, tone = 'neutral', dot, icon, testID, style }: BadgeProps): React.ReactElement {
  const { colors, radius } = useTheme();
  const tc = toneColors(colors, tone);
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: tc.bg, borderRadius: radius.pill }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: tc.solid }]} /> : null}
      {icon ? <Feather name={icon} size={12} color={tc.ink} style={styles.icon} /> : null}
      <Text variant="caption" weight="600" style={{ color: tc.ink, letterSpacing: 0.2 }}>
        {children ?? label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  icon: { marginRight: 4 },
});
