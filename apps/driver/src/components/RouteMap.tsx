import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import type { DriverStopView } from '@blue-bee/shared';

/**
 * A basic route map: the day's stops as numbered markers (PRD §4.4 "my route today" + map). Turn-by-
 * turn is a NATIVE-nav hand-off, not in-app routing. Isolated in its own component so screens that
 * don't need a map (and most tests) never pull in the native map module.
 */
export function RouteMap({ stops }: { stops: DriverStopView[] }): React.ReactElement {
  const located = stops.filter((s): s is DriverStopView & { lat: number; lng: number } => s.lat != null && s.lng != null);

  if (located.length === 0) {
    return (
      <View style={[styles.map, styles.empty]}>
        <Text style={styles.emptyText}>No mapped stops yet</Text>
      </View>
    );
  }

  const first = located[0]!;
  return (
    <MapView
      style={styles.map}
      provider={PROVIDER_DEFAULT}
      testID="route-map"
      initialRegion={{ latitude: first.lat, longitude: first.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
    >
      {located.map((s) => (
        <Marker
          key={s.id}
          coordinate={{ latitude: s.lat, longitude: s.lng }}
          title={`${s.seq}. ${s.siteName ?? 'Stop'}`}
          description={s.address ?? undefined}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: '100%', height: 220, borderRadius: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef1f4' },
  emptyText: { color: '#6b7280' },
});
