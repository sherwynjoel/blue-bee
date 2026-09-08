import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

/**
 * The shared Daylight surface — a raised, rounded (16) card with a hairline border, a soft e1 shadow,
 * and theme-aware fills.
 *
 * Reconciles both existing versions (superset, dropping nothing):
 *  - customer's `Card` had `title` / `titleAccessory` (an optional headline row), a numeric `padding`
 *    (0 for edge-to-edge media), a `flat` toggle (no shadow) and a `testID`;
 *  - driver/owner's kit `Card` had a boolean `padded` toggle (default true) instead of a numeric padding.
 * The shared version keeps ALL of them: `padding` (numeric) wins when set; otherwise `padded` decides
 * between `cardPadding` and 0 — so both apps' call sites keep working unchanged.
 */
export interface CardProps {
  children: React.ReactNode;
  /** Optional section title rendered as a headline above the content (customer). */
  title?: string;
  /** Right-aligned node in the title row, e.g. a Badge (customer). */
  titleAccessory?: React.ReactNode;
  /** Explicit inner padding. Pass 0 for edge-to-edge media (customer). Overrides `padded` when set. */
  padding?: number;
  /** Driver/owner's padding toggle — `false` collapses padding to 0. Ignored when `padding` is set. */
  padded?: boolean;
  /** Drop the soft e1 shadow, e.g. for nested wells (customer). */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  children,
  title,
  titleAccessory,
  padding,
  padded = true,
  flat,
  style,
  testID,
}: CardProps): React.ReactElement {
  const { colors, radius, elevation, cardPadding } = useTheme();
  const pad = padding ?? (padded ? cardPadding : 0);
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.hairline,
          padding: pad,
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
