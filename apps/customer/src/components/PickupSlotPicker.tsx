import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { PickupSlot, PickupSlotsResult } from '@blue-bee/shared';
import { dateKeyParts, windowText } from '../format';
import { useTheme } from '../../theme';
import { Card, EmptyState, Text, fireHaptic } from '../../components/ui';

export interface PickupSlotPickerProps {
  /** The day currently open, or null while the first day is still loading. */
  date: string | null;
  /** The server's answer for `date` — null while loading, or when the load failed. */
  day: PickupSlotsResult | null;
  loading: boolean;
  /** The server's problem+json message. Never swallowed: a customer must not book blind. */
  error: string | null;
  /** The label of the slot the customer has chosen on `date`, or null. */
  selectedLabel: string | null;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: PickupSlot) => void;
  onRetry: () => void;
}

/**
 * [Inc-28] The real pickup picker: a day strip fed by the server's `bookableDates`, and the chosen day's
 * windows fed by its `slots`.
 *
 * It replaced a single Switch labelled "Tomorrow morning window", which set a hard-coded 9am–12pm on the
 * device's own calendar regardless of the org's hours, timezone, lead time or capacity.
 *
 * Everything on screen is the server's answer. In particular:
 *
 *  • **The day strip is `bookableDates`.** The app never computes which days are open — a phone in another
 *    timezone would otherwise offer a Sunday the plant is shut.
 *
 *  • **An unavailable slot is disabled and says why**, using the server's `reason`. It is never hidden: a
 *    customer who can see that the morning is full understands the afternoon choice.
 *
 *  • **`remaining` is only ever rendered when the server actually counted.** `remaining: null` means no cap
 *    is configured, not "a low number we happen not to know" — so no "2 left" badge can be conjured from it.
 *    (Honesty firewall.)
 *
 *  • **A day with nothing bookable says so.** There is no silent fallback to a fabricated window; the parent
 *    keeps submit disabled until a real slot is chosen.
 */
export function PickupSlotPicker({
  date,
  day,
  loading,
  error,
  selectedLabel,
  onSelectDate,
  onSelectSlot,
  onRetry,
}: PickupSlotPickerProps): React.ReactElement {
  const { colors, space } = useTheme();

  // The strip survives a slot-load failure on ONE day (we keep the last good `bookableDates`), so the
  // customer can simply tap a different day instead of being dumped back to a blank card.
  const dates = day?.bookableDates ?? [];

  return (
    <Card title="Pickup window">
      {error ? (
        <View testID="slots-error" style={[styles.errorBox, { backgroundColor: colors.dangerTint }]}>
          <Text variant="footnote" color="danger" center>
            {error}
          </Text>
          <Pressable testID="slots-retry" onPress={onRetry} hitSlop={10} style={{ marginTop: 8 }} accessibilityRole="button">
            <Text variant="footnote" weight="600" color="azure" center>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}

      {dates.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
          {dates.map((d) => (
            <DayChip key={d} dateKey={d} selected={d === date} onPress={() => onSelectDate(d)} />
          ))}
        </ScrollView>
      ) : null}

      {loading ? (
        <View testID="slots-loading" style={styles.center}>
          <ActivityIndicator color={colors.azure} />
          <Text variant="footnote" color="secondary" style={{ marginTop: 8 }}>
            Checking availability…
          </Text>
        </View>
      ) : null}

      {!loading && !error && day ? <DayBody day={day} selectedLabel={selectedLabel} onSelectSlot={onSelectSlot} /> : null}

      {day && day.scheduleSource === 'default' ? (
        // Say it out loud. Until the founder saves real hours in the console, these are our documented
        // defaults, not Blue Bee's confirmed operating hours — and the customer deserves to know which.
        <Text testID="slots-default-note" variant="caption" color="tertiary" style={{ marginTop: space.sm }}>
          Standard pickup hours. We&apos;ll confirm your window when we schedule the driver.
        </Text>
      ) : null}
    </Card>
  );
}

/** The chosen day's windows, or an honest reason there are none. */
function DayBody({
  day,
  selectedLabel,
  onSelectSlot,
}: {
  day: PickupSlotsResult;
  selectedLabel: string | null;
  onSelectSlot: (slot: PickupSlot) => void;
}): React.ReactElement {
  if (day.closed) {
    return <EmptyState testID="slots-closed" icon="calendar" tone="neutral" title="We're closed that day" body="Pick another day for your pickup." />;
  }
  if (day.slots.length === 0) {
    return <EmptyState testID="slots-none" icon="calendar" tone="neutral" title="No pickup windows that day" body="Pick another day for your pickup." />;
  }
  if (day.slots.every((s) => !s.available)) {
    // Every window gone. Say which fact caused it rather than a generic shrug — `full` and `past` are
    // different problems, and only one of them is solved by waiting.
    const allFull = day.slots.every((s) => s.reason === 'full');
    return (
      <>
        <EmptyState
          testID="slots-empty"
          icon="calendar"
          tone="neutral"
          title={allFull ? 'Fully booked that day' : 'No pickups left that day'}
          body="Choose another day above — those windows are still open."
        />
        <View style={{ opacity: 0.55 }}>
          {day.slots.map((s) => (
            <SlotRow key={s.label} slot={s} selected={false} capacityChecked={day.capacityChecked} onPress={() => undefined} />
          ))}
        </View>
      </>
    );
  }

  return (
    <View testID="slots-list">
      {day.slots.map((s) => (
        <SlotRow
          key={s.label}
          slot={s}
          selected={s.label === selectedLabel}
          capacityChecked={day.capacityChecked}
          onPress={() => onSelectSlot(s)}
        />
      ))}
    </View>
  );
}

/** One day in the horizontal strip. */
function DayChip({ dateKey, selected, onPress }: { dateKey: string; selected: boolean; onPress: () => void }): React.ReactElement {
  const { colors, radius } = useTheme();
  const { weekday, day, month } = dateKeyParts(dateKey);
  return (
    <Pressable
      testID={`day-${dateKey}`}
      onPress={() => {
        fireHaptic('selection');
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${weekday} ${month} ${day}`}
      style={[
        styles.dayChip,
        {
          borderRadius: radius.card,
          backgroundColor: selected ? colors.azure : colors.surface,
          borderColor: selected ? colors.azure : colors.hairline,
        },
      ]}
    >
      <Text variant="caption" weight="600" style={{ color: selected ? colors.onAzure : colors.textSecondary }}>
        {weekday}
      </Text>
      <Text variant="headline" weight="700" style={{ color: selected ? colors.onAzure : colors.text, marginTop: 2 }}>
        {day}
      </Text>
      <Text variant="caption" style={{ color: selected ? colors.onAzure : colors.textTertiary }}>
        {month}
      </Text>
    </Pressable>
  );
}

/** The customer-facing copy for an unbookable window. Only ever driven by the server's `reason`. */
function unavailableText(slot: PickupSlot): string {
  switch (slot.reason) {
    case 'full':
      return 'Fully booked';
    case 'past':
      return 'No longer available';
    case 'lead_time':
      return 'Too soon to book';
    default:
      return 'Unavailable';
  }
}

/** One selectable pickup window. Disabled (not hidden) when the server says it cannot be booked. */
function SlotRow({
  slot,
  selected,
  capacityChecked,
  onPress,
}: {
  slot: PickupSlot;
  selected: boolean;
  capacityChecked: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const disabled = !slot.available;
  // A count may ONLY be shown when the server really counted against a real cap. `remaining: null` means
  // "no cap configured" — rendering "0 left" or "— left" from it would be inventing scarcity.
  const showRemaining = capacityChecked && slot.available && slot.remaining !== null && slot.remaining <= 3;

  return (
    <Pressable
      testID={`slot-${slot.label}`}
      onPress={() => {
        if (disabled) return;
        fireHaptic('selection');
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      style={[
        styles.slotRow,
        {
          borderColor: selected ? colors.azure : colors.hairline,
          backgroundColor: selected ? colors.azureTint : colors.surface,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Feather name={disabled ? 'slash' : 'clock'} size={18} color={selected ? colors.azure : colors.textTertiary} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text variant="subhead" weight="600">
          {slot.label}
        </Text>
        <Text testID={`slot-${slot.label}-time`} variant="footnote" color="secondary" style={{ marginTop: 1 }}>
          {windowText(slot.startLocal, slot.endLocal)}
        </Text>
      </View>

      {disabled ? (
        <Text testID={`slot-${slot.label}-reason`} variant="caption" color="tertiary">
          {unavailableText(slot)}
        </Text>
      ) : showRemaining ? (
        <Text testID={`slot-${slot.label}-remaining`} variant="caption" color="tertiary">
          {slot.remaining} left
        </Text>
      ) : null}

      {selected ? <Feather name="check-circle" size={18} color={colors.azure} style={{ marginLeft: 8 }} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dayStrip: { gap: 8, paddingBottom: 14, paddingRight: 4 },
  dayChip: { minWidth: 60, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1.5 },
  slotRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 8 },
  center: { alignItems: 'center', paddingVertical: 24 },
  errorBox: { borderRadius: 12, padding: 12, marginBottom: 12 },
});
