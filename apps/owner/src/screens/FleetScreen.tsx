import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { type NavigationProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import { useFleet } from '../fleet/useFleet';
import type { FleetVehicle } from '../fleet/fleet-controller';
import { FleetMap } from '../components/FleetMap';
import { ErrorBox, Loading } from '../components/ui';
import { Badge, Text, useTheme, type Tone } from '@blue-bee/ui';
import { Row, Screen } from '../components/kit';
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
  const t = useTheme();
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
  const conn: { tone: Tone; label: string; dot: boolean } =
    fleet.phase === 'live'
      ? { tone: 'success', label: 'Live', dot: true }
      : fleet.phase === 'connecting'
        ? { tone: 'neutral', label: 'Connecting…', dot: false }
        : { tone: 'warning', label: 'Snapshot · polling', dot: true };

  return (
    <Screen scroll testID="fleet">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: t.space.md }}>
        <Text variant="title1">Live fleet</Text>
        <Badge tone={conn.tone} dot={conn.dot}>
          {conn.label}
        </Badge>
      </View>

      <FleetMap vehicles={fleet.vehicles} onSelect={(v) => void onSelect(v)} />

      {note ? (
        <Text variant="footnote" color={t.colors.onWarningTint} style={{ marginTop: 10 }}>
          {note}
        </Text>
      ) : null}

      <Text variant="footnote" color={t.colors.textSecondary} style={{ marginTop: t.space.lg, marginBottom: t.space.sm }} tabular>
        {positioned.length} reporting · {fleet.idleCount} idle
      </Text>

      <View style={{ gap: 10 }}>
        {fleet.vehicles.map((v) => (
          <Row key={v.vehicleId} testID={`fleet-row-${v.vehicleId}`} onPress={() => void onSelect(v)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text variant="headline">{v.label}</Text>
                <Text variant="footnote" color={t.colors.textTertiary} style={{ marginTop: 2 }}>
                  {v.hasPosition ? (v.live ? 'live' : `updated ${timeAgo(v.recordedAt)}`) : 'no position yet'}
                </Text>
              </View>
              {v.live ? (
                <Badge tone="success" dot>
                  live
                </Badge>
              ) : v.hasPosition ? (
                <Badge tone="azure">snapshot</Badge>
              ) : (
                <Badge tone="neutral">idle</Badge>
              )}
            </View>
          </Row>
        ))}
      </View>
    </Screen>
  );
}
