import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { VehiclePosition } from '../tracking/tracking-controller';

/**
 * The live truck on a real `react-native-maps` map. The vehicle pin comes from the tracking state
 * (REST last-known, then live `position` events refine it). A null vehicle (no position yet) renders
 * the map without a pin — never a blank screen.
 */
export function TrackMap({ vehicle }: { vehicle: VehiclePosition | null }): React.ReactElement {
  const region: Region | undefined = vehicle
    ? { latitude: vehicle.lat, longitude: vehicle.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : undefined;

  return (
    <View style={styles.wrap}>
      <MapView style={styles.map} testID="track-map" region={region} initialRegion={region}>
        {vehicle ? (
          <Marker
            testID="vehicle-marker"
            coordinate={{ latitude: vehicle.lat, longitude: vehicle.lng }}
            title="Your Blue Bee driver"
            rotation={vehicle.heading ?? 0}
            flat
          />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 240, borderRadius: 12, overflow: 'hidden' },
  map: { ...StyleSheet.absoluteFillObject },
});
