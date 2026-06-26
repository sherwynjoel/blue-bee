import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { type NavigationProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import { useFleet } from '../fleet/useFleet';
import type { FleetVehicle } from '../fleet/fleet-controller';
import { FleetMap } from '../components/FleetMap';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { timeAgo } from '../format';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;

/**
 * Live fleet (PRD §7C C1) — every outbound vehicle on a real map, REST `GET /fleet/live` as the
 * source of truth refined by live `WS /live/fleet` positions, degrading to REST polling (never blank).
 * Tapping a vehicle resolves its active route and drills into the stops (§7C C5). Org-scoped server-
 * side (the owner only ever sees their own org's fleet).
 */
export function FleetScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const { client } = useSession();
  const fleet = useFleet(client);
  const [note, setNote] = useState<string | null>(null);

  // Resolve a tapped vehicle's active route (IN_PROGRESS, else a published route) and drill in.
  const onSelect = useCallback(
    async (v: FleetVehicle): Promise<void> => {
      setNote(null);
      try {
        const inProgress = await client.listRoutes('IN_PROGRESS');
        let route = inProgress.routes.find((r) => r.vehicleId === v.vehicleId);
        if (!route) {
          const published = await client.listRoutes('PUBLISHED');
          route = published.routes.find((r) => r.vehicleId === v.vehicleId);
        }
        if (route) navigation.navigate('RouteDetail', { routeId: route.id, title: v.label });
        else setNote(`No active route for ${v.label} right now.`);
      } catch {
        setNote('Could not load the route. Try again.');
      }
    },
    [client, navigation],
  );

  if (fleet.phase === 'loading' && fleet.vehicles.length === 0) return <Loading label="Loading fleet…" />;
  if (fleet.phase === 'error' && fleet.vehicles.length === 0)
    return <ErrorBox message={fleet.error ?? 'Could not load the fleet.'} onRetry={fleet.reload} />;

  const positioned = fleet.vehicles.filter((v) => v.hasPosition);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="fleet">
      <View style={styles.header}>
        <Text style={styles.heading}>Live fleet</Text>
        <Badge tone={fleet.phase === 'live' ? 'green' : 'amber'}>
          {fleet.phase === 'live' ? '● Live' : fleet.phase === 'connecting' ? 'Connecting…' : 'Snapshot (polling)'}
        </Badge>
      </View>

      <FleetMap vehicles={fleet.vehicles} onSelect={(v) => void onSelect(v)} />

      {note ? <Text style={styles.note}>{note}</Text> : null}

      <Text style={styles.sectionTitle}>
        {positioned.length} reporting · {fleet.idleCount} idle
      </Text>
      {fleet.vehicles.map((v) => (
        <TouchableOpacity
          key={v.vehicleId}
          style={styles.row}
          onPress={() => void onSelect(v)}
          testID={`fleet-row-${v.vehicleId}`}
        >
          <View style={styles.rowText}>
            <Text style={styles.label}>{v.label}</Text>
            <Text style={styles.muted}>
              {v.hasPosition ? (v.live ? 'live' : `updated ${timeAgo(v.recordedAt)}`) : 'no position yet'}
            </Text>
          </View>
          {v.live ? <Badge tone="green">live</Badge> : v.hasPosition ? <Badge tone="blue">snapshot</Badge> : <Badge tone="gray">idle</Badge>}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: '800', color: '#1f2328' },
  note: { color: '#9a6700', marginTop: 10 },
  sectionTitle: { marginTop: 16, marginBottom: 8, color: '#57606a', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eaeef2' },
  rowText: { flex: 1 },
  label: { fontSize: 15, fontWeight: '700', color: '#1f2328' },
  muted: { color: '#8c959f', fontSize: 12, marginTop: 2 },
});
