import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DriverStopView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { RouteMap } from '../components/RouteMap';
import { isTerminal } from '../stops/actions';
import type { RouteProps } from '../navigation';

/** "My route today" — the optimized stop sequence + a map. Tap a stop to work it. */
export function RouteScreen({ navigation }: RouteProps): React.ReactElement {
  const { assignment } = useSession();
  const route = assignment?.route ?? null;

  if (!route) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No route assigned.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <RouteMap stops={route.stops} />
      {route.stops.map((stop) => (
        <StopRow key={stop.id} stop={stop} onPress={() => navigation.navigate('Stop', { stopId: stop.id })} />
      ))}
    </ScrollView>
  );
}

function StopRow({ stop, onPress }: { stop: DriverStopView; onPress: () => void }): React.ReactElement {
  return (
    <TouchableOpacity testID={`stop-row-${stop.id}`} style={styles.row} onPress={onPress}>
      <View style={styles.seqBubble}>
        <Text style={styles.seqText}>{stop.seq}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.siteName}>{stop.siteName ?? 'Stop'}</Text>
        {stop.address ? <Text style={styles.address}>{stop.address}</Text> : null}
        {stop.eta ? <Text style={styles.eta}>ETA {new Date(stop.eta).toLocaleTimeString()}</Text> : null}
      </View>
      <StatusPill status={stop.status} terminal={isTerminal(stop.status)} />
    </TouchableOpacity>
  );
}

function StatusPill({ status, terminal }: { status: string; terminal: boolean }): React.ReactElement {
  return (
    <View style={[styles.pill, terminal ? styles.pillTerminal : styles.pillActive]}>
      <Text style={styles.pillText}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#6b7280' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, gap: 12 },
  seqBubble: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center' },
  seqText: { color: '#fff', fontWeight: '700' },
  rowBody: { flex: 1 },
  siteName: { fontWeight: '600', color: '#111827' },
  address: { color: '#6b7280', fontSize: 12 },
  eta: { color: '#1f6feb', fontSize: 12, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  pillActive: { backgroundColor: '#dbeafe' },
  pillTerminal: { backgroundColor: '#e5e7eb' },
  pillText: { fontSize: 11, color: '#1f2937' },
});
