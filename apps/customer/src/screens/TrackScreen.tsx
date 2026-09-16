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
import { Badge, Button, Card, Glass, Hero, IconBadge, SkeletonCard, Text, type BadgeTone } from '../../components/ui';

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
 * pure presentation: a Royal brand header before the map has anything to paint, a full-bleed map, a
 * floating connection chip, and a floating Card ETA panel (IconBadge + Badge) with the §12.2 privacy
 * "sharing" indicator.
 */
export function TrackScreen({ route }: { route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useVehicleTracking(client, orderId);

  // Static brand header — shown only pre-map (loading/error), when there's nothing yet to paint
  // full-bleed. Once the map is live it takes over the screen; the floating chip below carries
  // connection status instead.
  const preMapHeader = (
    <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 12 }}>
      <Hero testID="track-hero">
        <View style={styles.heroRow}>
          <IconBadge icon="truck" tone="azure" size={40} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text variant="title3" weight="700">
              Track my truck
            </Text>
            <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
              Your driver’s live location, right here, in real time.
            </Text>
          </View>
        </View>
      </Hero>
    </View>
  );

  if (t.phase === 'loading') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {preMapHeader}
        {/* Skeletons, not a spinner — the same loading language every other screen speaks. */}
        <View testID="track-loading" style={{ paddingHorizontal: 20, marginTop: 8, gap: 14 }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (t.phase === 'error') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {preMapHeader}
        <Card style={styles.stateCard}>
          <Feather name="map-pin" size={26} color={colors.textTertiary} />
          <Text variant="headline" weight="600" center style={{ marginTop: 14 }}>
            Couldn’t load tracking
          </Text>
          <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
            {t.error ?? 'Please try again in a moment.'}
          </Text>
          <Button testID="track-retry" label="Try again" icon="refresh-cw" variant="outline" onPress={t.retry} fullWidth={false} style={{ marginTop: 18 }} />
        </Card>
      </View>
    );
  }

  const live = t.phase === 'live';
  const connecting = t.phase === 'connecting' || t.phase === 'degraded';
  const hasStop = !!t.stop;
  // A token-scoped live channel is actually open/reconnecting (NOT the token-less 'rest' state). The
  // §12.2 "sharing" claim must only show while location is genuinely being shared — never in 'rest'.
  const channelOpen = live || connecting;
  // 'rest' (last-known, nothing wrong) reads as neutral, not a warning — only an active reconnect does.
  const chipColor = live ? colors.success : connecting ? colors.warning : colors.textTertiary;

  return (
    <View style={styles.container}>
      <TrackMap vehicle={t.vehicle} arrived={t.arrived} />

      {/* Connection status chip (the always-visible "reconnecting" affordance — never a janky blank). */}
      <View style={[styles.topChip, { top: space.md }]} pointerEvents="box-none">
        <Glass style={styles.chip} radius={radius.pill}>
          <View style={styles.chipInner}>
            {connecting ? (
              <ActivityIndicator size="small" color={chipColor} style={{ marginRight: space.sm }} />
            ) : (
              <View style={[styles.dot, { backgroundColor: chipColor }]} />
            )}
            <Text testID="track-phase" variant="footnote" weight="600">
              {PHASE_TEXT[t.phase] ?? t.phase}
            </Text>
          </View>
        </Glass>
      </View>

      {/* Floating ETA card */}
      <View style={[styles.bottom, { paddingHorizontal: space.lg, paddingBottom: Math.max(insets.bottom, space.lg) }]} pointerEvents="box-none">
        <Card padding={space.xl} style={{ borderRadius: radius.sheet }}>
          {t.arrived ? (
            <View style={styles.statusLine}>
              <IconBadge icon="check-circle" tone="success" size={32} />
              <Text testID="arrived" variant="headline" weight="700" color="success" style={{ marginLeft: space.md, flex: 1 }}>
                Your driver has arrived 🎉
              </Text>
            </View>
          ) : t.approaching ? (
            <View style={styles.statusLine}>
              <IconBadge icon="truck" tone="azure" size={32} />
              <Text testID="approaching" variant="headline" weight="700" color="azure" style={{ marginLeft: space.md, flex: 1 }}>
                Your driver is approaching
              </Text>
            </View>
          ) : null}

          {hasStop ? (
            <>
              <Text variant="footnote" color="secondary" style={{ marginTop: t.arrived || t.approaching ? space.md : 0 }}>
                {(t.stop?.kind ?? '').toLowerCase() === 'delivery' ? 'Estimated delivery' : 'Estimated arrival'}
              </Text>
              <Text testID="eta" variant="display" weight="700" mono style={{ marginTop: 2 }}>
                {t.eta ? etaText(t.eta.low, t.eta.high, t.eta.eta) : 'calculating…'}
              </Text>
              <Badge
                label={`${titleCase(t.stop?.kind ?? 'Stop')} · ${(t.stop?.status ?? '').replace(/_/g, ' ').toLowerCase()}`}
                tone={stopTone(t.stop?.status ?? '')}
                style={{ marginTop: space.sm }}
              />

              {/* §12.2 privacy: the visible "sharing on" indicator — shown ONLY while a token-scoped
                  live channel is actually open/reconnecting (never in the token-less 'rest' state, so
                  the claim is never made when nothing is being shared). */}
              {channelOpen ? (
                <View style={[styles.sharing, { borderTopColor: colors.hairline, marginTop: space.md, paddingTop: space.md }]}>
                  <Feather name="shield" size={14} color={colors.success} />
                  <Text variant="caption" color="secondary" style={{ marginLeft: 6, flex: 1 }}>
                    Live location is shared only for this stop, just with you.
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.noStop}>
              <IconBadge icon="clock" tone="neutral" size={36} />
              <Text testID="no-active-stop" variant="subhead" color="secondary" style={{ marginLeft: space.md, flex: 1 }}>
                Your order isn’t out for pickup or delivery right now. We’ll notify you when the truck is on the way.
              </Text>
            </View>
          )}

          {t.vehicle ? (
            <Text variant="caption" color="tertiary" style={{ marginTop: space.md }}>
              Last update {shortTime(t.vehicle.recordedAt)}
              {t.source === 'live' ? ' · live' : ''}
            </Text>
          ) : null}

          {t.closedReason && t.phase !== 'live' ? (
            <Text testID="closed-reason" variant="caption" color="tertiary" style={{ marginTop: 2 }}>
              ({t.closedReason.replace(/_/g, ' ')})
            </Text>
          ) : null}
        </Card>
      </View>
    </View>
  );
}

function titleCase(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Maps the raw stop status string to a Royal tone — success once arrived/complete, azure while en
 *  route, danger on a failed/skipped stop, neutral otherwise (queued/assigned/etc). */
function stopTone(status: string): BadgeTone {
  const s = status.toUpperCase();
  if (s.includes('ARRIVED') || s.includes('COMPLETE')) return 'success';
  if (s.includes('EN_ROUTE')) return 'azure';
  if (s.includes('FAILED') || s.includes('SKIPPED')) return 'danger';
  return 'neutral';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1 },
  stateCard: { marginHorizontal: 20, marginTop: 8, alignItems: 'center', paddingVertical: 28 },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  topChip: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  chip: { alignSelf: 'center' },
  chipInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  statusLine: { flexDirection: 'row', alignItems: 'center' },
  sharing: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  noStop: { flexDirection: 'row', alignItems: 'flex-start' },
});
