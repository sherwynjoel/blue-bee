import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

export interface KeyValueProps {
  label: string;
  value: string;
  /** Emphasize as a total row (larger, bold value). */
  total?: boolean;
  /** Render value with tabular figures (money/counts). Defaults true. */
  tabular?: boolean;
  testID?: string;
}

/** A "label …………… value" line for quotes, totals, receipts. Values use tabular figures by default. */
export function KeyValue({ label, value, total, tabular = true, testID }: KeyValueProps): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text variant={total ? 'headline' : 'subhead'} color={total ? 'primary' : 'secondary'} weight={total ? '600' : '400'}>
        {label}
      </Text>
      <Text testID={testID} variant={total ? 'headline' : 'subhead'} weight={total ? '700' : '500'} tabular={tabular}>
        {value}
      </Text>
    </View>
  );
}

/** A hairline divider. */
export function Divider({ spacing = 12 }: { spacing?: number }): React.ReactElement {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginVertical: spacing }} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
});
