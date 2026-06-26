import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { OrderStatus } from '@blue-bee/shared';
import { buildTimeline } from '../orders/timeline';
import { useTheme } from '../../theme';
import { Text } from '../../components/ui';

/**
 * The §5.1 status timeline — the signature Daylight progress spine, rendered FROM SERVER STATE
 * (`order.status` + `heldFrom`). It never invents progress: `buildTimeline` is a pure mapping of the
 * server status onto the canonical spine. Done steps are checked + connected with a solid rail; the
 * current step gets an emphasized ring; upcoming steps are hollow. A branch/hold note renders as an
 * honest info chip.
 */
export function StatusTimeline({
  status,
  heldFrom,
}: {
  status: OrderStatus;
  heldFrom?: OrderStatus | null;
}): React.ReactElement {
  const { colors, space } = useTheme();
  const { steps, note } = buildTimeline(status, heldFrom);
  const lastIdx = steps.length - 1;

  return (
    <View testID="status-timeline">
      {steps.map((step, i) => {
        const done = step.state === 'done';
        const current = step.state === 'current';
        // The connector below a step is "complete" only when this step itself is done.
        const connectorColor = done ? colors.success : colors.hairline;

        return (
          <View key={step.status} style={styles.row}>
            <View style={styles.rail}>
              {/* node */}
              {done ? (
                <View style={[styles.dotDone, { backgroundColor: colors.success }]}>
                  <Feather name="check" size={11} color={colors.onAzure} />
                </View>
              ) : current ? (
                <View style={[styles.ring, { borderColor: colors.azure, backgroundColor: colors.azureTint }]}>
                  <View style={[styles.ringCore, { backgroundColor: colors.azure }]} />
                </View>
              ) : (
                <View style={[styles.dotUpcoming, { borderColor: colors.hairline, backgroundColor: colors.surface }]} />
              )}
              {/* connector to the next node */}
              {i < lastIdx ? <View style={[styles.connector, { backgroundColor: connectorColor }]} /> : null}
            </View>

            <Text
              variant="subhead"
              weight={current ? '700' : done ? '500' : '400'}
              color={current ? 'azure' : done ? 'primary' : 'tertiary'}
              style={styles.label}
            >
              {step.label}
            </Text>
          </View>
        );
      })}

      {note ? (
        <View style={[styles.note, { backgroundColor: colors.warningTint, marginTop: space.md }]}>
          <Feather name="info" size={15} color={colors.warning} style={{ marginTop: 1 }} />
          <Text testID="timeline-note" variant="footnote" color="warning" style={styles.noteText}>
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const NODE = 22;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  rail: { width: NODE, alignItems: 'center' },
  dotDone: { width: NODE, height: NODE, borderRadius: NODE / 2, alignItems: 'center', justifyContent: 'center' },
  ring: { width: NODE, height: NODE, borderRadius: NODE / 2, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  ringCore: { width: 8, height: 8, borderRadius: 4 },
  dotUpcoming: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginVertical: (NODE - 14) / 2 },
  connector: { width: 2, flex: 1, minHeight: 14, marginVertical: 2 },
  // No fixed line-height/min-height here so labels grow (never clip) with Dynamic Type; the rail's
  // node sits at the top and the short label aligns alongside it.
  label: { marginLeft: 14, paddingTop: 2, flex: 1 },
  note: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, padding: 12, gap: 8 },
  noteText: { flex: 1, lineHeight: 18 },
});
