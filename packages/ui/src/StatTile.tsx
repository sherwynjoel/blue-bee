import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, toneColors, type Tone } from './theme';
import { Text } from './Text';

/**
 * A metric tile — a big tabular value with a caption, plus (optionally) a raised card wrapper, a tinted
 * icon chip, a hint line and a tone-tinted value.
 *
 * This is the MOST divergent reconciliation of the five primitives — the two existing versions are not a
 * prop-diff of one shape, they are two structurally different tiles that happen to share the "one metric"
 * idea:
 *  - driver/owner's kit `Stat` is a SELF-CONTAINED CARD (surface + hairline + e1 shadow + padding) with a
 *    big MONO tabular value (title1 @ 30pt), a footnote label, an optional `hint`, an optional tone that
 *    tints the value, and a `valueTestID`. No icon.
 *  - customer's `StatTile` is a BARE block (no card chrome) with an optional tinted ICON CHIP above the
 *    value, a title3 tabular value tinted only when `emphasize` is set, and a caption label. It depends on
 *    the customer-local `IconBadge` for its chip.
 *
 * The shared version is the superset:
 *  - `card` (default true) toggles the driver/owner card chrome; customer's inline tiles pass `card={false}`.
 *  - `icon` renders the tinted chip inline (the same tint-fill + bright-hue-icon motif as customer's
 *    `IconBadge`) so this package does NOT depend on a customer-local component — see the task report's
 *    flagged finding about `IconBadge` staying app-local while `StatTile` (which uses that motif) is shared.
 *  - `tone` colours the chip, and — only when `emphasize` is set — the value (unifying driver's "tone tints
 *    the value" with customer's "emphasize tints the value"; both apps pass the matching prop at migration).
 *  - `mono` defaults to `card` (KPI figures are mono; customer's inline figures are not) and value size
 *    follows `card` (title1 @ 30pt vs title3), preserving each app's existing look.
 */
export interface StatTileProps {
  /** Big value line (e.g. "128", "$15.00"). Rendered with tabular figures. */
  value: string;
  /** Small caption under the value. */
  label: string;
  /** Accent tone — tints the icon chip, and (with `emphasize`) the value. */
  tone?: Tone;
  /** Optional Feather icon shown in a tinted chip above the value (customer's motif). */
  icon?: React.ComponentProps<typeof Feather>['name'];
  /** Small caption under the label (driver/owner's KPI hint). */
  hint?: string;
  /** Tint the value in the tone hue. */
  emphasize?: boolean;
  /** Wrap in a raised card (surface + hairline + e1 shadow + padding) — driver/owner KPIs. Default true. */
  card?: boolean;
  /** Monospaced tabular value (driver/owner KPI figures). Defaults to `card`. */
  mono?: boolean;
  testID?: string;
  valueTestID?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatTile({
  value,
  label,
  tone = 'neutral',
  icon,
  hint,
  emphasize,
  card = true,
  mono,
  testID,
  valueTestID,
  style,
}: StatTileProps): React.ReactElement {
  const { colors, radius, elevation, cardPadding } = useTheme();
  const tc = toneColors(colors, tone);
  const useMono = mono ?? card;
  const valueColor = emphasize ? tc.ink : colors.text;

  const cardStyle: ViewStyle | null = card
    ? {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.hairline,
        padding: cardPadding,
        ...elevation.e1,
      }
    : null;

  return (
    <View testID={testID} style={[styles.wrap, cardStyle, style]}>
      {icon ? (
        <View style={[styles.chip, { backgroundColor: tc.bg, borderRadius: radius.input }]}>
          <Feather name={icon} size={16} color={tc.solid} />
        </View>
      ) : null}
      <Text
        variant={card ? 'title1' : 'title3'}
        weight="700"
        mono={useMono}
        tabular
        color={valueColor}
        testID={valueTestID}
        style={card ? styles.bigValue : undefined}
      >
        {value}
      </Text>
      <Text variant={card ? 'footnote' : 'caption'} color="secondary" numberOfLines={1} style={{ marginTop: card ? 6 : 2 }}>
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color="tertiary" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start' },
  chip: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  bigValue: { fontSize: 30, lineHeight: 34 },
  hint: { marginTop: 2 },
});
