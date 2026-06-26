import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

export interface CardProps {
  children: React.ReactNode;
  /** Optional section title rendered as a headline above the content. */
  title?: string;
  /** Right-aligned node in the title row (e.g. a Badge). */
  titleAccessory?: React.ReactNode;
  /** Inner padding (defaults to the theme card padding). Pass 0 for edge-to-edge media. */
  padding?: number;
  /** Drop the soft shadow (e.g. for nested wells). */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A raised Daylight surface — rounded 16, hairline border, soft e1 shadow, theme-aware. */
export function Card({ children, title, titleAccessory, padding, flat, style, testID }: CardProps): React.ReactElement {
  const { colors, radius, elevation, cardPadding } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.hairline,
          padding: padding ?? cardPadding,
        },
        flat ? null : elevation.e1,
        style,
      ]}
    >
      {title ? (
        <View style={styles.titleRow}>
          <Text variant="headline" weight="600">
            {title}
          </Text>
          {titleAccessory}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
});
