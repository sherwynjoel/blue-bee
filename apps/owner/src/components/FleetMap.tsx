import React from 'react';
import { Text as RNText, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { Feather } from '@expo/vector-icons';
import type { FleetVehicle } from '../fleet/fleet-controller';
import { useTheme } from '@blue-bee/ui';

/**
 * The org fleet on a real `react-native-maps` map (PRD §7C C1). Each positioned vehicle is a branded
 * marker (green when a live WS position is overlaid, azure from the REST snapshot). Tapping a marker
 * drills to the vehicle's route. A vehicle with no position is omitted from the map (listed below as
 * idle). When no vehicle has a position yet the map area shows a placeholder — never a blank screen.
 * Follows light/dark via the map's `userInterfaceStyle`.
 */
export function FleetMap({
  vehicles,
  onSelect,
}: {
  vehicles: FleetVehicle[];
  onSelect?: (v: FleetVehicle) => void;
}): React.ReactElement {
  const t = useTheme();
  const located = vehicles.filter(
    (v): v is FleetVehicle & { lat: number; lng: number } => v.hasPosition && v.lat != null && v.lng != null,
  );

  if (located.length === 0) {
    return (
      <View
        testID="fleet-map-empty"
        style={{
          width: '100%',
          height: 260,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.colors.hairline,
          backgroundColor: t.colors.subtle,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 16,
        }}
      >
        <Feather name="truck" size={26} color={t.colors.textTertiary} />
        <RNText style={{ color: t.colors.textTertiary, textAlign: 'center', fontSize: 13 }}>No vehicles are reporting a position yet.</RNText>
      </View>
    );
  }

  const first = located[0]!;
  const region: Region = { latitude: first.lat, longitude: first.lng, latitudeDelta: 0.3, longitudeDelta: 0.3 };

  return (
    <MapView
      style={{ width: '100%', height: 280, borderRadius: t.radius.card }}
      provider={PROVIDER_DEFAULT}
      userInterfaceStyle={t.isDark ? 'dark' : 'light'}
      testID="fleet-map"
      initialRegion={region}
    >
      {located.map((v) => (
        <Marker
          key={v.vehicleId}
          testID={`vehicle-marker-${v.vehicleId}`}
          coordinate={{ latitude: v.lat, longitude: v.lng }}
          title={v.label}
          description={v.live ? 'Live' : 'Last known'}
          onPress={() => onSelect?.(v)}
          onCalloutPress={() => onSelect?.(v)}
        >
          <VehiclePin color={v.live ? t.colors.success : t.colors.azure} />
        </Marker>
      ))}
    </MapView>
  );
}

/** A branded circular vehicle marker (truck glyph, white ring). */
function VehiclePin({ color }: { color: string }): React.ReactElement {
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: color,
        borderWidth: 3,
        borderColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Feather name="truck" size={16} color="#FFFFFF" />
    </View>
  );
}
