import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

export type BadgeTone = 'azure' | 'success' | 'warning' | 'danger' | 'honey' | 'neutral';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /** Show a leading status dot. */
  dot?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A small status pill — tinted fill + tone-colored label, optional leading dot. */
export function Badge({ label, tone = 'neutral', dot, testID, style }: BadgeProps): React.ReactElement {
  const { colors, radius } = useTheme();
  // fg = legible on-tint text; dotc = the bright hue (decorative dot). Keeps the pill readable in both themes.
  const map: Record<BadgeTone, { fg: string; bg: string; dotc: string }> = {
    azure: { fg: colors.onAzureTint, bg: colors.azureTint, dotc: colors.azure },
    success: { fg: colors.onSuccessTint, bg: colors.successTint, dotc: colors.success },
    warning: { fg: colors.onWarningTint, bg: colors.warningTint, dotc: colors.warning },
    danger: { fg: colors.onDangerTint, bg: colors.dangerTint, dotc: colors.danger },
    honey: { fg: colors.onHoneyTint, bg: colors.honeyTint, dotc: colors.honey },
    neutral: { fg: colors.textSecondary, bg: colors.subtle, dotc: colors.textSecondary },
  };
  const { fg, bg, dotc } = map[tone];
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: bg, borderRadius: radius.pill }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: dotc }]} /> : null}
      <Text variant="caption" weight="600" style={{ color: fg, letterSpacing: 0.2 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
});
