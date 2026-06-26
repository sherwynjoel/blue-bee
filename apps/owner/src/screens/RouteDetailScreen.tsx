import React, { useCallback } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { RouteDetail, RouteStopView } from '../api/types';
import { useAsync } from '../useAsync';
import { shortTime } from '../format';
import { Badge, EmptyState, ErrorBox, Loading, type Tone } from '../components/ui';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'RouteDetail'>;

function stopTone(status: string): Tone {
  if (status === 'COMPLETED') return 'green';
  if (status === 'FAILED' || status === 'SKIPPED') return 'red';
  if (status === 'EN_ROUTE' || status === 'ARRIVED' || status === 'IN_PROGRESS') return 'blue';
  return 'gray';
}

/**
 * Route drill-through (PRD §7C C5) — a truck's ordered stops. Read-only; tapping a stop with an order
 * opens that order's detail (chain of custody). The route + its stops come from the proven scoped
 * `GET /v1/routes/:id` (org-scoped server-side).
 */
export function RouteDetailScreen({ navigation, route }: { navigation: Nav; route: Route }): React.ReactElement {
  const { routeId } = route.params;
  const { client } = useSession();
  const { data, loading, error, reload } = useAsync<RouteDetail>(() => client.getRoute(routeId), [client, routeId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loading && !data) return <Loading label="Loading route…" />;
  if ((error && !data) || !data) {
    return <ErrorBox message={error ?? 'Route not found.'} onRetry={reload} />;
  }

  const stops = data.stops ?? [];

  return (
    <FlatList
      testID="route-detail"
      style={styles.container}
      contentContainerStyle={styles.content}
      data={stops}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.heading}>Route</Text>
          <Badge tone="blue">{data.status}</Badge>
        </View>
      }
      ListEmptyComponent={<EmptyState message="This route has no stops." />}
      renderItem={({ item }) => (
        <StopRow item={item} onPress={item.orderId ? () => navigation.navigate('OrderDetail', { orderId: item.orderId! }) : undefined} />
      )}
    />
  );
}

function StopRow({ item, onPress }: { item: RouteStopView; onPress?: () => void }): React.ReactElement {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress} testID={`stop-${item.id}`}>
      <View style={styles.seqWrap}>
        <Text style={styles.seq}>{item.seq}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.stopTitle}>
          {item.kind}
          {item.site?.name ? ` · ${item.site.name}` : ''}
        </Text>
        <Text style={styles.muted}>
          {item.eta ? `ETA ${shortTime(item.eta)}` : item.completedAt ? `Done ${shortTime(item.completedAt)}` : 'No ETA'}
          {item.exceptionReason ? ` · ${item.exceptionReason}` : ''}
        </Text>
      </View>
      <Badge tone={stopTone(item.status)}>{item.status}</Badge>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: '800', color: '#1f2328' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eaeef2' },
  seqWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#ddf4ff', alignItems: 'center', justifyContent: 'center' },
  seq: { fontWeight: '800', color: '#0969da' },
  rowText: { flex: 1 },
  stopTitle: { fontWeight: '700', color: '#1f2328' },
  muted: { color: '#8c959f', fontSize: 12, marginTop: 2 },
});
