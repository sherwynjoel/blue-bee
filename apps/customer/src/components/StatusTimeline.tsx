import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OrderStatus } from '@blue-bee/shared';
import { buildTimeline } from '../orders/timeline';

/**
 * The §5.1 status timeline, rendered FROM SERVER STATE (`order.status` + `heldFrom`). It never
 * invents progress — `buildTimeline` is a pure mapping of the server status onto the canonical spine.
 */
export function StatusTimeline({
  status,
  heldFrom,
}: {
  status: OrderStatus;
  heldFrom?: OrderStatus | null;
}): React.ReactElement {
  const { steps, note } = buildTimeline(status, heldFrom);
  return (
    <View testID="status-timeline">
      {steps.map((step) => (
        <View key={step.status} style={styles.row}>
          <View
            style={[
              styles.dot,
              step.state === 'done' && styles.dotDone,
              step.state === 'current' && styles.dotCurrent,
            ]}
          />
          <Text
            style={[
              styles.label,
              step.state === 'upcoming' && styles.labelUpcoming,
              step.state === 'current' && styles.labelCurrent,
            ]}
          >
            {step.label}
          </Text>
        </View>
      ))}
      {note ? (
        <Text testID="timeline-note" style={styles.note}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#d0d7de', marginRight: 12 },
  dotDone: { backgroundColor: '#1f883d' },
  dotCurrent: { backgroundColor: '#1f6feb' },
  label: { fontSize: 15, color: '#1f2328' },
  labelUpcoming: { color: '#8c959f' },
  labelCurrent: { fontWeight: '700', color: '#0969da' },
  note: { marginTop: 8, color: '#9a6700', fontStyle: 'italic' },
});
