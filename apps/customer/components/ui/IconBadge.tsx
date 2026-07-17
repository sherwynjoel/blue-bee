import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';

export type IconTone = 'azure' | 'success' | 'warning' | 'danger' | 'honey' | 'neutral';

export interface IconBadgeProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  tone?: IconTone;
  /** Container edge length in pt (default 40). */
  size?: number;
  /** Full circle instead of a rounded square. */
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Royal "icon in a tinted chip" motif — the visual rhythm that ties every screen together
 * (quick actions, list rows, stat tiles, trust strips). A tinted fill + the bright tone-hue icon.
 */
export function IconBadge({ icon, tone = 'azure', size = 40, circle = false, style }: IconBadgeProps): React.ReactElement {
  const { colors, radius } = useTheme();
  const map: Record<IconTone, { fg: string; bg: string }> = {
    azure: { fg: colors.azure, bg: colors.azureTint },
    success: { fg: colors.success, bg: colors.successTint },
    warning: { fg: colors.warning, bg: colors.warningTint },
    danger: { fg: colors.danger, bg: colors.dangerTint },
    honey: { fg: colors.honey, bg: colors.honeyTint },
    neutral: { fg: colors.textSecondary, bg: colors.subtle },
  };
  const { fg, bg } = map[tone];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: circle ? size / 2 : radius.input,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Feather name={icon} size={Math.round(size * 0.46)} color={fg} />
    </View>
  );
}
