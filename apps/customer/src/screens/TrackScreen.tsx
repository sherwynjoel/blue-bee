import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { TrackMap } from '../components/TrackMap';
import { useVehicleTracking } from '../tracking/useVehicleTracking';
import { etaText, shortTime } from '../format';
import { useTheme } from '../../theme';
import { Button, Glass, Text } from '../../components/ui';

type Route = RouteProp<RootStackParamList, 'Track'>;

const PHASE_TEXT: Record<string, string> = {
  loading: 'Loading…',
  connecting: 'Connecting to live updates…',
  live: 'Live',
  rest: 'Last known location',
  degraded: 'Reconnecting — showing last known',
  error: 'Couldn’t load tracking',
};

/**
 * "Track my truck" (PRD §6.2/§6.4, US-T2) — the marquee screen. REST is the source of truth (first
 * paint + the fallback); the live socket only refines it. A dropped socket / dead token / closed
 * channel degrades to the REST last-known + a subtle "reconnecting" affordance — never a blank screen,
 * never an invented position. The `useVehicleTracking` resilience state machine is unchanged; this is
 * pure presentation: a full-bleed map, a branded pulsing marker, and a floating glass ETA card with
 * the §12.2 privacy "sharing" indicator.
 */
export function TrackScreen({ route }: { route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useVehicleTracking(client, orderId);

  if (t.phase === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator testID="track-loading" size="large" color={colors.azure} />
        <Text variant="subhead" color="secondary" style={{ marginTop: 12 }}>
          Finding your driver…
        </Text>
      </View>
    );
  }

  if (t.phase === 'error') {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <Feather name="map-pin" size={30} color={colors.textTertiary} />
        <Text variant="headline" weight="600" center style={{ marginTop: 14 }}>
          Couldn’t load tracking
        </Text>
        <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
          {t.error ?? 'Please try again in a moment.'}
        </Text>
        <Button testID="track-retry" label="Try again" icon="refresh-cw" variant="outline" onPress={t.retry} fullWidth={false} style={{ marginTop: 18 }} />
      </View>
    );
  }

  const live = t.phase === 'live';
  const connecting = t.phase === 'connecting' || t.phase === 'degraded';
  const hasStop = !!t.stop;
  // A token-scoped live channel is actually open/reconnecting (NOT the token-less 'rest' state). The
  // §12.2 "sharing" claim must only show while location is genuinely being shared — never in 'rest'.
  const channelOpen = live || connecting;
  const statusColor = live ? colors.success : colors.warning;

  return (
    <View style={styles.container}>
      <TrackMap vehicle={t.vehicle} arrived={t.arrived} />

      {/* Connection status chip (the always-visible "reconnecting" affordance — never a janky blank). */}
      <View style={[styles.topChip, { top: space.md }]} pointerEvents="box-none">
        <Glass style={styles.chip} radius={999}>
          <View style={styles.chipInner}>
            {connecting ? (
              <ActivityIndicator size="small" color={statusColor} style={{ marginRight: 8 }} />
            ) : (
              <View style={[styles.dot, { backgroundColor: statusColor }]} />
            )}
            <Text testID="track-phase" variant="footnote" weight="600">
              {PHASE_TEXT[t.phase] ?? t.phase}
            </Text>
          </View>
        </Glass>
      </View>

      {/* Floating glass ETA card */}
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.lg) }]} pointerEvents="box-none">
        <Glass style={styles.etaCard} radius={24}>
          <View style={styles.etaInner}>
            {t.arrived ? (
              <View style={styles.statusLine}>
                <View style={[styles.statusIcon, { backgroundColor: colors.successTint }]}>
                  <Feather name="check-circle" size={18} color={colors.success} />
                </View>
                <Text testID="arrived" variant="headline" weight="700" color="success">
                  Your driver has arrived 🎉
                </Text>
              </View>
            ) : t.approaching ? (
              <View style={styles.statusLine}>
                <View style={[styles.statusIcon, { backgroundColor: colors.azureTint }]}>
                  <Feather name="truck" size={18} color={colors.azure} />
                </View>
                <Text testID="approaching" variant="headline" weight="700" color="azure">
                  Your driver is approaching
                </Text>
              </View>
            ) : null}

            {hasStop ? (
              <>
                <Text variant="footnote" color="secondary" style={{ marginTop: t.arrived || t.approaching ? 12 : 0 }}>
                  {(t.stop?.kind ?? '').toLowerCase() === 'delivery' ? 'Estimated delivery' : 'Estimated arrival'}
                </Text>
                <Text testID="eta" variant="display" weight="700" mono style={{ marginTop: 2 }}>
                  {t.eta ? etaText(t.eta.low, t.eta.high, t.eta.eta) : 'calculating…'}
                </Text>
                <Text variant="footnote" color="tertiary" style={{ marginTop: 2 }}>
                  {titleCase(t.stop?.kind ?? 'Stop')} · {(t.stop?.status ?? '').replace(/_/g, ' ').toLowerCase()}
                </Text>

                {/* §12.2 privacy: the visible "sharing on" indicator — shown ONLY while a token-scoped
                    live channel is actually open/reconnecting (never in the token-less 'rest' state, so
                    the claim is never made when nothing is being shared). */}
                {channelOpen ? (
                  <View style={[styles.sharing, { borderTopColor: colors.hairline }]}>
                    <Feather name="shield" size={14} color={colors.success} />
                    <Text variant="caption" color="secondary" style={{ marginLeft: 6, flex: 1 }}>
                      Live location is shared only for this stop, just with you.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.noStop}>
                <Feather name="clock" size={18} color={colors.textTertiary} />
                <Text testID="no-active-stop" variant="subhead" color="secondary" style={{ marginLeft: 10, flex: 1 }}>
                  Your order isn’t out for pickup or delivery right now. We’ll notify you when the truck is on the way.
                </Text>
              </View>
            )}

            {t.vehicle ? (
              <Text variant="caption" color="tertiary" style={{ marginTop: 10 }}>
                Last update {shortTime(t.vehicle.recordedAt)}
                {t.source === 'live' ? ' · live' : ''}
              </Text>
            ) : null}

            {t.closedReason && t.phase !== 'live' ? (
              <Text testID="closed-reason" variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                ({t.closedReason.replace(/_/g, ' ')})
              </Text>
            ) : null}
          </View>
        </Glass>
      </View>
    </View>
  );
}

function titleCase(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topChip: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  chip: { alignSelf: 'center' },
  chipInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16 },
  etaCard: {},
  etaInner: { padding: 20 },
  statusLine: { flexDirection: 'row', alignItems: 'center' },
  statusIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  sharing: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  noStop: { flexDirection: 'row', alignItems: 'flex-start' },
});
