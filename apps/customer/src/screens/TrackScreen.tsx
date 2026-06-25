import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { TrackMap } from '../components/TrackMap';
import { useVehicleTracking } from '../tracking/useVehicleTracking';
import { etaText, shortTime } from '../format';

type Route = RouteProp<RootStackParamList, 'Track'>;

const PHASE_TEXT: Record<string, string> = {
  loading: 'Loading…',
  connecting: 'Connecting to live updates…',
  live: 'Live',
  rest: 'Last known location',
  degraded: 'Live updates paused — showing last known',
  error: 'Couldn’t load tracking',
};

/**
 * "Track my truck" (PRD §6.2/§6.4, US-T2). REST is the source of truth (first paint + the fallback);
 * the live socket only refines it. A dropped socket / dead token / closed channel degrades to the
 * REST last-known + a clear banner — never a blank screen, never an invented position.
 */
export function TrackScreen({ route }: { route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const t = useVehicleTracking(client, orderId);

  if (t.phase === 'loading') {
    return <ActivityIndicator testID="track-loading" style={styles.center} size="large" color="#1f6feb" />;
  }

  if (t.phase === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{t.error ?? 'Couldn’t load tracking.'}</Text>
        <TouchableOpacity testID="track-retry" onPress={t.retry}>
          <Text style={styles.link}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const live = t.phase === 'live';
  const hasStop = !!t.stop;

  return (
    <View style={styles.container}>
      <View style={[styles.banner, live ? styles.bannerLive : styles.bannerRest]}>
        <View style={[styles.dot, live ? styles.dotLive : styles.dotRest]} />
        <Text testID="track-phase" style={styles.bannerText}>
          {PHASE_TEXT[t.phase] ?? t.phase}
        </Text>
      </View>

      <TrackMap vehicle={t.vehicle} />

      <View style={styles.info}>
        {t.arrived ? (
          <Text testID="arrived" style={styles.arrived}>
            🎉 Your driver has arrived
          </Text>
        ) : t.approaching ? (
          <Text testID="approaching" style={styles.approaching}>
            🚚 Your driver is approaching
          </Text>
        ) : null}

        {hasStop ? (
          <>
            <Text style={styles.etaLabel}>Estimated arrival</Text>
            <Text testID="eta" style={styles.eta}>
              {t.eta ? etaText(t.eta.low, t.eta.high, t.eta.eta) : 'calculating…'}
            </Text>
            <Text style={styles.muted}>Stop status: {t.stop?.status}</Text>
          </>
        ) : (
          <Text testID="no-active-stop" style={styles.muted}>
            Your order isn’t out for pickup or delivery right now. We’ll notify you when the truck is on the way.
          </Text>
        )}

        {t.vehicle ? (
          <Text style={styles.muted}>Last update {shortTime(t.vehicle.recordedAt)}{t.source === 'live' ? ' · live' : ''}</Text>
        ) : null}

        {t.closedReason && t.phase !== 'live' ? (
          <Text testID="closed-reason" style={styles.muted}>
            ({t.closedReason.replace(/_/g, ' ')})
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  banner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, gap: 8 },
  bannerLive: { backgroundColor: '#dafbe1' },
  bannerRest: { backgroundColor: '#fff8c5' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotLive: { backgroundColor: '#1a7f37' },
  dotRest: { backgroundColor: '#9a6700' },
  bannerText: { color: '#1f2328', fontWeight: '600' },
  info: { padding: 20, gap: 6 },
  etaLabel: { color: '#57606a', marginTop: 8 },
  eta: { fontSize: 28, fontWeight: '700', color: '#1f2328' },
  approaching: { fontSize: 18, fontWeight: '700', color: '#0969da' },
  arrived: { fontSize: 18, fontWeight: '700', color: '#1a7f37' },
  muted: { color: '#57606a', marginTop: 4 },
  link: { color: '#1f6feb' },
  error: { color: '#b91c1c', textAlign: 'center' },
});
