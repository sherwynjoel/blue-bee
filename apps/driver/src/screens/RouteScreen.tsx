import React from 'react';
import { View } from 'react-native';
import type { DriverStopView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { RouteMap } from '../components/RouteMap';
import { isTerminal } from '../stops/actions';
import { stopStatusMeta } from '../stops/status-ui';
import { Badge, Text, useTheme } from '@blue-bee/ui';
import { EmptyState, Row, Screen } from '../components/kit';
import type { RouteProps } from '../navigation';

/** "My route today" — the optimized stop sequence + a map. Tap a stop to work it. */
export function RouteScreen({ navigation }: RouteProps): React.ReactElement {
  const t = useTheme();
  const route = useSession().assignment?.route ?? null;

  if (!route) {
    return <EmptyState icon="map" title="No route assigned" message="Your route for today hasn't been published yet." />;
  }

  if (route.stops.length === 0) {
    return <EmptyState icon="map-pin" title="No stops assigned" message="There are no stops on your route yet. Pull to refresh on the shift screen." />;
  }

  const done = route.stops.filter((s) => isTerminal(s.status)).length;

  return (
    <Screen scroll>
      <RouteMap stops={route.stops} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 12 }}>
        <Text variant="headline">Stops</Text>
        <Text variant="footnote" color={t.colors.textSecondary} tabular>
          {done}/{route.stops.length} done
        </Text>
      </View>
      <View style={{ gap: 10 }}>
        {route.stops.map((stop) => (
          <StopRow key={stop.id} stop={stop} onPress={() => navigation.navigate('Stop', { stopId: stop.id })} />
        ))}
      </View>
    </Screen>
  );
}

function StopRow({ stop, onPress }: { stop: DriverStopView; onPress: () => void }): React.ReactElement {
  const t = useTheme();
  const meta = stopStatusMeta(stop.status);
  const terminal = isTerminal(stop.status);
  return (
    <Row testID={`stop-row-${stop.id}`} onPress={onPress} chevron>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: terminal ? t.colors.subtle : t.colors.azureTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="headline" mono tabular color={terminal ? t.colors.textTertiary : t.colors.azure}>
            {stop.seq}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline" numberOfLines={1}>
            {stop.siteName ?? 'Stop'}
          </Text>
          {stop.address ? (
            <Text variant="footnote" color={t.colors.textSecondary} numberOfLines={1} style={{ marginTop: 2 }}>
              {stop.address}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Badge tone={meta.tone} icon={meta.icon}>
              {meta.label}
            </Badge>
            {stop.eta ? (
              <Text variant="caption" color={t.colors.textTertiary} mono tabular>
                ETA {new Date(stop.eta).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Row>
  );
}
