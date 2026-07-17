import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { fireHaptic } from './haptics';

export interface SectionHeaderProps {
  title: string;
  /** Optional right-aligned action link (e.g. "See all"). */
  actionLabel?: string;
  onAction?: () => void;
  /** Optional caption under the title. */
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A group heading — bold title, optional subtitle, optional right-aligned azure action link. */
export function SectionHeader({ title, actionLabel, onAction, subtitle, style, testID }: SectionHeaderProps): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={styles.texts}>
        <Text variant="title3" weight="700">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={() => {
            fireHaptic('selection');
            onAction();
          }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          style={styles.action}
        >
          <Text variant="subhead" weight="600" style={{ color: colors.azure }}>
            {actionLabel}
          </Text>
          <Feather name="chevron-right" size={16} color={colors.azure} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  texts: { flex: 1 },
  action: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
});
