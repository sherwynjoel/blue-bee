import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DriverStopAction } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { ApiError } from '../api/problem';
import { ACTION_LABEL, availableActions, isTerminal, reasonsFor, requiresReason } from '../stops/actions';
import type { StopProps } from '../navigation';

/**
 * One stop — its details + the legal §5.4 actions. depart/arrive/start/complete are one tap;
 * fail/skip prompt for a reason code (required). The server is authority: a 409 (illegal transition,
 * e.g. someone else moved the stop) is surfaced and the assignment re-synced (handled in the session).
 */
export function StopScreen({ route, navigation }: StopProps): React.ReactElement {
  const { stopId } = route.params;
  const { assignment, doStopAction } = useSession();
  const [busy, setBusy] = useState<DriverStopAction | null>(null);

  const stop = assignment?.route?.stops.find((s) => s.id === stopId) ?? null;

  if (!stop) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>This stop is no longer on your route.</Text>
      </View>
    );
  }

  const actions = availableActions(stop.status);

  async function run(action: DriverStopAction, reason?: string): Promise<void> {
    setBusy(action);
    try {
      await doStopAction(stopId, action, reason ? { reason } : {});
      if (isTerminal(stop?.status ?? '') || action === 'complete') {
        // completed/failed/skipped → back to the route list
      }
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        Alert.alert('Already updated', 'The office updated this stop. Showing the latest status.');
      } else {
        Alert.alert('Action failed', e instanceof ApiError ? e.message : 'Please try again.');
      }
    } finally {
      setBusy(null);
    }
  }

  function onPress(action: DriverStopAction): void {
    if (!requiresReason(action)) {
      void run(action);
      return;
    }
    // fail/skip → pick a reason code (required)
    const reasons = reasonsFor(action);
    Alert.alert(
      ACTION_LABEL[action],
      'Pick a reason',
      [
        ...reasons.map((r) => ({ text: r.replace(/_/g, ' '), onPress: () => void run(action, r) })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.site}>{stop.siteName ?? 'Stop'}</Text>
        {stop.address ? <Text style={styles.address}>{stop.address}</Text> : null}
        <Detail label="Stop #" value={String(stop.seq)} />
        <Detail label="Kind" value={stop.kind} />
        <Detail label="Status" value={stop.status} />
        {stop.timeWindow ? (
          <Detail label="Window" value={`${new Date(stop.timeWindow.start).toLocaleTimeString()} – ${new Date(stop.timeWindow.end).toLocaleTimeString()}`} />
        ) : null}
        {stop.eta ? <Detail label="ETA" value={new Date(stop.eta).toLocaleTimeString()} /> : null}
        {stop.exceptionReason ? <Detail label="Reason" value={stop.exceptionReason} /> : null}
      </View>

      <View style={styles.actions}>
        {isTerminal(stop.status) ? (
          <Text style={styles.terminal}>This stop is {stop.status.toLowerCase()}.</Text>
        ) : actions.length === 0 ? (
          <Text style={styles.empty}>No actions available.</Text>
        ) : (
          actions.map((action) => (
            <TouchableOpacity
              key={action}
              testID={`action-${action}`}
              style={[styles.actionBtn, action === 'fail' || action === 'skip' ? styles.actionWarn : styles.actionPrimary, busy && styles.disabled]}
              onPress={() => onPress(action)}
              disabled={busy !== null}
            >
              {busy === action ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>{ACTION_LABEL[action]}</Text>}
            </TouchableOpacity>
          ))
        )}
      </View>

      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>Back to route</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 6 },
  site: { fontSize: 20, fontWeight: '700', color: '#111827' },
  address: { color: '#6b7280', marginBottom: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  detailLabel: { color: '#6b7280' },
  detailValue: { color: '#111827', fontWeight: '600' },
  actions: { gap: 10 },
  actionBtn: { borderRadius: 10, padding: 16, alignItems: 'center' },
  actionPrimary: { backgroundColor: '#1f6feb' },
  actionWarn: { backgroundColor: '#b45309' },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.6 },
  terminal: { color: '#374151', textAlign: 'center' },
  empty: { color: '#6b7280', textAlign: 'center' },
  back: { padding: 12, alignItems: 'center' },
  backText: { color: '#1f6feb', fontWeight: '600' },
});
