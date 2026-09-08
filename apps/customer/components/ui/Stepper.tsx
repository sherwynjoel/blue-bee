import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from '@blue-bee/ui';

export interface StepperProps {
  /** Ordered step labels (e.g. ["Schedule", "Review", "Confirm"]). */
  steps: string[];
  /** 0-based index of the current step. Steps before it read as done. */
  current: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A horizontal progress stepper used by the booking wizard and the payment flow. Three visual states:
 * done (azure fill + check), current (azure fill + number), upcoming (hairline outline + muted number).
 */
export function Stepper({ steps, current, style, testID }: StepperProps): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, style]} testID={testID} accessibilityRole="progressbar">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const on = done || active;
        const circleBg = on ? colors.azure : colors.surface;
        const circleBorder = on ? colors.azure : colors.hairline;
        const numColor = on ? colors.onAzure : colors.textTertiary;
        const labelColor = active ? colors.text : done ? colors.textSecondary : colors.textTertiary;
        return (
          <React.Fragment key={label}>
            <View style={styles.step}>
              <View style={[styles.circle, { backgroundColor: circleBg, borderColor: circleBorder }]}>
                {done ? (
                  <Feather name="check" size={15} color={colors.onAzure} />
                ) : (
                  <Text variant="footnote" weight="700" style={{ color: numColor }}>
                    {String(i + 1)}
                  </Text>
                )}
              </View>
              <Text variant="caption" weight={active ? '700' : '500'} numberOfLines={1} style={{ color: labelColor, marginTop: 6 }}>
                {label}
              </Text>
            </View>
            {i < steps.length - 1 ? (
              <View style={[styles.connector, { backgroundColor: i < current ? colors.azure : colors.hairline }]} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { alignItems: 'center', width: 84 },
  circle: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  connector: { flex: 1, height: 2, borderRadius: 1, marginTop: 14 },
});
