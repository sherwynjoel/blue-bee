import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { IconBadge, type IconTone } from './IconBadge';

export interface StatTileProps {
  /** Big value line (e.g. "128", "$15.00"). Rendered with tabular figures. */
  value: string;
  /** Small caption under the value. */
  label: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  iconTone?: IconTone;
  /** Tint the value in the tone hue (e.g. green credits). */
  emphasize?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A compact metric tile — optional icon chip, a bold tabular value, and a muted label. */
export function StatTile({ value, label, icon, iconTone = 'azure', emphasize, style, testID }: StatTileProps): React.ReactElement {
  const { colors } = useTheme();
  const toneColor: Record<IconTone, string> = {
    azure: colors.azure,
    success: colors.onSuccessTint,
    warning: colors.onWarningTint,
    danger: colors.onDangerTint,
    honey: colors.onHoneyTint,
    neutral: colors.text,
  };
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      {icon ? <IconBadge icon={icon} tone={iconTone} size={34} style={{ marginBottom: 8 }} /> : null}
      <Text variant="title3" weight="700" tabular style={emphasize ? { color: toneColor[iconTone] } : undefined}>
        {value}
      </Text>
      <Text variant="caption" color="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start' },
});
