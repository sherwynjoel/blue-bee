import React from 'react';
import { Text as RNText, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Feather } from '@expo/vector-icons';
import type { DriverStopView } from '@blue-bee/shared';
import { toneColors, useTheme } from '@blue-bee/ui';
import { stopStatusMeta } from '../stops/status-ui';

/**
 * A basic route map: the day's stops as branded, status-coloured numbered markers (PRD §4.4 "my route
 * today" + map). Turn-by-turn is a NATIVE-nav hand-off, not in-app routing. Isolated in its own
 * component so screens that don't need a map (and most tests) never pull in the native map module.
 * Follows light/dark via the map's `userInterfaceStyle`.
 */
export function RouteMap({ stops }: { stops: DriverStopView[] }): React.ReactElement {
  const t = useTheme();
  const located = stops.filter((s): s is DriverStopView & { lat: number; lng: number } => s.lat != null && s.lng != null);

  if (located.length === 0) {
    return (
      <View
        style={{
          width: '100%',
          height: 200,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.colors.hairline,
          backgroundColor: t.colors.subtle,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Feather name="map" size={26} color={t.colors.textTertiary} />
        <RNText style={{ color: t.colors.textTertiary, fontSize: 13 }}>No mapped stops yet</RNText>
      </View>
    );
  }

  const first = located[0]!;
  return (
    <MapView
      style={{ width: '100%', height: 220, borderRadius: t.radius.card }}
      provider={PROVIDER_DEFAULT}
      userInterfaceStyle={t.isDark ? 'dark' : 'light'}
      testID="route-map"
      initialRegion={{ latitude: first.lat, longitude: first.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
    >
      {located.map((s) => (
        <Marker key={s.id} coordinate={{ latitude: s.lat, longitude: s.lng }} title={`${s.seq}. ${s.siteName ?? 'Stop'}`} description={s.address ?? undefined}>
          <Pin seq={s.seq} color={toneColors(t.colors, stopStatusMeta(s.status).tone).solid} />
        </Marker>
      ))}
    </MapView>
  );
}

/** A branded teardrop marker: an azure (or status-coloured) pill with the stop's sequence number. */
function Pin({ seq, color }: { seq: number; color: string }): React.ReactElement {
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          backgroundColor: color,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: '#FFFFFF',
          minWidth: 26,
          alignItems: 'center',
        }}
      >
        <RNText style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12 }}>{seq}</RNText>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 5,
          borderRightWidth: 5,
          borderTopWidth: 7,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
          marginTop: -1,
        }}
      />
    </View>
  );
}
