import React from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, usePressScale } from '../../theme';
import { fireHaptic, type HapticKind } from './haptics';
import { Text } from '@blue-bee/ui';

export interface RowProps {
  title: string;
  subtitle?: string;
  /** A Feather icon shown in a tinted leading circle. */
  icon?: React.ComponentProps<typeof Feather>['name'];
  iconTone?: 'azure' | 'success' | 'warning' | 'danger' | 'honey' | 'neutral';
  /** Right-aligned accessory (value Text, Badge, Switch…). */
  right?: React.ReactNode;
  onPress?: () => void;
  /** Show a trailing chevron (defaults true when onPress is set). */
  chevron?: boolean;
  haptic?: HapticKind;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** An inset list row — leading icon chip, title/subtitle, right accessory, optional chevron. */
export function Row({
  title,
  subtitle,
  icon,
  iconTone = 'azure',
  right,
  onPress,
  chevron,
  haptic = 'selection',
  testID,
  style,
}: RowProps): React.ReactElement {
  const { colors, radius, space } = useTheme();
  const press = usePressScale(!!onPress);
  const showChevron = chevron ?? !!onPress;

  const toneColor =
    iconTone === 'azure'
      ? colors.azure
      : iconTone === 'success'
        ? colors.success
        : iconTone === 'warning'
          ? colors.warning
          : iconTone === 'danger'
            ? colors.danger
            : iconTone === 'honey'
              ? colors.honey
              : colors.textSecondary;
  const toneTint =
    iconTone === 'azure'
      ? colors.azureTint
      : iconTone === 'success'
        ? colors.successTint
        : iconTone === 'warning'
          ? colors.warningTint
          : iconTone === 'danger'
            ? colors.dangerTint
            : iconTone === 'honey'
              ? colors.honeyTint
              : colors.subtle;

  const body = (
    <Animated.View style={[styles.row, { transform: press.transform }, style]}>
      {icon ? (
        <View style={[styles.iconChip, { backgroundColor: toneTint, borderRadius: radius.input }]}>
          <Feather name={icon} size={18} color={toneColor} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="body" weight="500" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="secondary" numberOfLines={2} style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ marginLeft: space.sm }}>{right}</View> : null}
      {showChevron ? <Feather name="chevron-right" size={20} color={colors.textTertiary} style={{ marginLeft: 4 }} /> : null}
    </Animated.View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        fireHaptic(haptic);
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: 8 },
  iconChip: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  texts: { flex: 1 },
});
