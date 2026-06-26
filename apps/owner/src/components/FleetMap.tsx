import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import type { FleetVehicle } from '../fleet/fleet-controller';

/**
 * The org fleet on a real `react-native-maps` map (PRD §7C C1). Each positioned vehicle is a marker
 * (green when a live WS position is overlaid, blue from the REST snapshot). Tapping a marker drills to
 * the vehicle's route. A vehicle with no position is omitted from the map (listed below as idle). When
 * no vehicle has a position yet the map area shows a placeholder — never a blank screen.
 */
export function FleetMap({
  vehicles,
  onSelect,
}: {
  vehicles: FleetVehicle[];
  onSelect?: (v: FleetVehicle) => void;
}): React.ReactElement {
  const located = vehicles.filter(
    (v): v is FleetVehicle & { lat: number; lng: number } => v.hasPosition && v.lat != null && v.lng != null,
  );

  if (located.length === 0) {
    return (
      <View style={[styles.map, styles.empty]} testID="fleet-map-empty">
        <Text style={styles.emptyText}>No vehicles are reporting a position yet.</Text>
      </View>
    );
  }

  const first = located[0]!;
  const region: Region = { latitude: first.lat, longitude: first.lng, latitudeDelta: 0.3, longitudeDelta: 0.3 };

  return (
    <MapView style={styles.map} provider={PROVIDER_DEFAULT} testID="fleet-map" initialRegion={region}>
      {located.map((v) => (
        <Marker
          key={v.vehicleId}
          testID={`vehicle-marker-${v.vehicleId}`}
          coordinate={{ latitude: v.lat, longitude: v.lng }}
          title={v.label}
          description={v.live ? 'Live' : 'Last known'}
          rotation={v.heading ?? 0}
          pinColor={v.live ? '#1a7f37' : '#1f6feb'}
          onCalloutPress={() => onSelect?.(v)}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: '100%', height: 280, borderRadius: 12 },
  empty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef1f4', padding: 16 },
  emptyText: { color: '#6b7280', textAlign: 'center' },
});
