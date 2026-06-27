import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { VehiclePosition } from '../tracking/tracking-controller';
import { useTheme, usePulse } from '../../theme';
import { DARK_MAP_STYLE } from './mapStyle';

/**
 * The live truck on a real `react-native-maps` map (the §6 hero). The vehicle pin comes from the
 * tracking state (REST last-known, then live `position` events refine it). A null vehicle (no position
 * yet) renders the map without a pin — never a blank screen. Light/dark map styling follows the theme.
 *
 * NOTE (honesty): the order tracking read returns only the vehicle's last-known + the stop's ETA — it
 * carries NO destination coordinate, so we do NOT draw a route line or destination dot (we never
 * fabricate geometry). The pin + ETA card are the real, source-of-truth surface.
 */
export function TrackMap({ vehicle, arrived }: { vehicle: VehiclePosition | null; arrived?: boolean }): React.ReactElement {
  const { isDark, colors } = useTheme();
  const region: Region | undefined = vehicle
    ? { latitude: vehicle.lat, longitude: vehicle.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    : undefined;

  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        testID="track-map"
        region={region}
        initialRegion={region}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        customMapStyle={isDark ? DARK_MAP_STYLE : []}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        pitchEnabled={false}
      >
        {vehicle ? (
          <Marker
            testID="vehicle-marker"
            coordinate={{ latitude: vehicle.lat, longitude: vehicle.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title="Your Blue Bee driver"
          >
            <VehicleMarker heading={vehicle.heading} color={arrived ? colors.success : colors.azure} onColor={colors.onAzure} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

/** A branded marker — a soft pulsing halo around an azure disc with a heading arrow. */
function VehicleMarker({ heading, color, onColor }: { heading: number | null; color: string; onColor: string }): React.ReactElement {
  const pulse = usePulse(true);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.7] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.38, 0] });
  return (
    <View style={styles.marker}>
      <Animated.View style={[styles.halo, { backgroundColor: color, transform: [{ scale }], opacity }]} />
      <View style={[styles.core, { backgroundColor: color }]}>
        <Feather name="navigation" size={15} color={onColor} style={{ transform: [{ rotate: `${heading ?? 0}deg` }] }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject },
  map: { ...StyleSheet.absoluteFillObject },
  marker: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 28, height: 28, borderRadius: 14 },
  core: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
});
