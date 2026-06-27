import React, { useCallback } from 'react';
import { FlatList, View } from 'react-native';
import { useFocusEffect, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { RouteDetail, RouteStopView } from '../api/types';
import { useAsync } from '../useAsync';
import { shortTime } from '../format';
import { ErrorBox, Loading } from '../components/ui';
import { Badge, EmptyState, Row, Text, useTheme, type Tone } from '../components/kit';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'RouteDetail'>;

function stopTone(status: string): Tone {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'SKIPPED') return 'warning'; // match the family (driver status-ui + owner Exceptions)
  if (status === 'EN_ROUTE' || status === 'ARRIVED' || status === 'IN_PROGRESS') return 'azure';
  return 'neutral';
}

/**
 * Route drill-through (PRD §7C C5) — a truck's ordered stops. Read-only; tapping a stop with an order
 * opens that order's detail (chain of custody). The route + its stops come from the proven scoped
 * `GET /v1/routes/:id` (org-scoped server-side).
 */
export function RouteDetailScreen({ navigation, route }: { navigation: Nav; route: Route }): React.ReactElement {
  const t = useTheme();
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
      style={{ flex: 1, backgroundColor: t.color.canvas }}
      contentContainerStyle={{ padding: t.spacing.lg, flexGrow: 1 }}
      data={stops}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: t.spacing.md }}>
          <Text variant="title1">Route</Text>
          <Badge tone="azure">{data.status}</Badge>
        </View>
      }
      ListEmptyComponent={<EmptyState icon="map-pin" title="No stops on this route" message="There are no stops assigned to this route yet." />}
      renderItem={({ item }) => (
        <StopRow item={item} onPress={item.orderId ? () => navigation.navigate('OrderDetail', { orderId: item.orderId! }) : undefined} />
      )}
    />
  );
}

function StopRow({ item, onPress }: { item: RouteStopView; onPress?: () => void }): React.ReactElement {
  const t = useTheme();
  return (
    <Row testID={`stop-${item.id}`} onPress={onPress} chevron={!!onPress} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 38, height: 38, borderRadius: t.radius.input, backgroundColor: t.color.azureTint, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="headline" color={t.color.azure} mono tabular>
            {item.seq}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline" numberOfLines={1}>
            {item.kind}
            {item.site?.name ? ` · ${item.site.name}` : ''}
          </Text>
          <Text variant="footnote" color={t.color.textFaint} style={{ marginTop: 2 }}>
            {item.eta ? `ETA ${shortTime(item.eta)}` : item.completedAt ? `Done ${shortTime(item.completedAt)}` : 'No ETA'}
            {item.exceptionReason ? ` · ${item.exceptionReason}` : ''}
          </Text>
        </View>
        <Badge tone={stopTone(item.status)}>{item.status}</Badge>
      </View>
    </Row>
  );
}
