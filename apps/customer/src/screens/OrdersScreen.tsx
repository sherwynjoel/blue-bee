import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import { ApiError } from '@blue-bee/api-client';
import { OrderStatus } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { OrderSummary } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { orderRef, rangeText, shortDate, shortTime } from '../format';
import { isRateable } from '../orders/rating';
import { StarRating } from '../components/StarRating';
import { useTheme, usePressScale, useEntrance } from '../../theme';
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  Hero,
  IconBadge,
  type IconTone,
  SkeletonCard,
  StatTile,
  Text,
} from '../../components/ui';
import { buildCustomerTimeline, customerStatus, type CustomerTimeline, type CustomerTone } from '../orders/timeline';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** Order statuses the customer sees as "wrapped up" — success or an honest early stop. Used ONLY to
 *  derive the stats-strip counts from orders already on screen; never a separate fetch/invented number. */
const COMPLETED_STATUSES = new Set<OrderStatus>([
  OrderStatus.DELIVERED,
  OrderStatus.INVOICED,
  OrderStatus.CLOSED,
  OrderStatus.CLOSED_NO_WORK,
  OrderStatus.QUOTE_DECLINED,
  OrderStatus.CLAIM_RESOLVED,
]);

/** The customer's 4-stage color language (§ spec): azure = placed/picked-up, orange = out for
 *  delivery, green = delivered. Extended (not in the reference) for the honest on-hold / exception
 *  cases every real tenant's data can produce. IconTone and BadgeTone share the exact same literal
 *  set, so one mapping feeds both the icon chip and the status pill. */
function toTone(tone: CustomerTone): IconTone {
  switch (tone) {
    case 'delivered':
      return 'success';
    case 'transit':
      return 'warning';
    case 'exception':
      return 'danger';
    case 'hold':
      return 'warning';
    case 'active':
    default:
      return 'azure';
  }
}

function stageIcon(tone: CustomerTone): FeatherName {
  switch (tone) {
    case 'delivered':
      return 'check-circle';
    case 'transit':
      return 'truck';
    case 'exception':
      return 'x-circle';
    case 'hold':
      return 'pause-circle';
    default:
      return 'package';
  }
}

function toneHex(tone: IconTone, colors: ReturnType<typeof useTheme>['colors']): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    case 'honey':
      return colors.honey;
    case 'neutral':
      return colors.textTertiary;
    default:
      return colors.azure;
  }
}

/** Honest "not built yet" affordance — a real, tappable, clearly-labeled dead end (never a fabricated
 *  feature pretending to work). Used for the bell + the trust-strip items with no backing screen. */
function showComingSoon(feature: string): void {
  Alert.alert(feature, "Coming soon — we're still building this.");
}

/** Amount + suffix, split for the two-line price used in the list/tracking rows. Reads exactly the
 *  same fields the original single-line `money()`/`rangeText()` helpers did — never invented. */
function priceParts(order: OrderSummary): { amount: string; suffix: string } {
  const latestQuote = order.quotes?.[0];
  if (latestQuote?.total) {
    const n = Number(latestQuote.total);
    return { amount: Number.isFinite(n) ? `$${n.toFixed(2)}` : `$${latestQuote.total}`, suffix: order.totals?.currency ?? 'CAD' };
  }
  if (order.totals?.estimateRange) {
    const { low, high, currency } = order.totals.estimateRange;
    return { amount: rangeText(low, high, currency), suffix: 'est.' };
  }
  return { amount: '—', suffix: '' };
}

/** "My orders" (PRD §7A) — the customer's own orders, row-scoped server-side (GET /v1/orders). */
export function OrdersScreen({ navigation }: { navigation: NavigationProp<RootStackParamList> }): React.ReactElement {
  const { client } = useSession();
  const { colors, space, elevation } = useTheme();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const trackingY = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable testID="settings" onPress={() => navigation.navigate('Settings')} hitSlop={12} accessibilityLabel="Settings">
          <Feather name="settings" size={22} color={colors.azure} />
        </Pressable>
      ),
    });
  }, [navigation, colors.azure]);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const result = await client.listOrders({ limit: 50 });
      setOrders(result.orders);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your orders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const scrollToTracking = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(trackingY.current - 12, 0), animated: true });
  }, []);

  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Stats strip — counts derived ONLY from the orders already loaded on screen, never a separate number.
  const total = orders.length;
  const completedCount = orders.reduce((n, o) => (COMPLETED_STATUSES.has(o.status) ? n + 1 : n), 0);
  const inProgressCount = total - completedCount;
  // Real-time tracking section: every order still worth tracking (delivered included — it's the happy
  // ending of the tracker). Declined / closed-without-work orders never reached the happy path, so
  // buildCustomerTimeline gives them no current step — they're skipped here (their pill in the compact
  // list above already tells the honest story).
  const trackedOrders = orders.filter((o) => !customerStatus(o.status).terminatedEarly);

  const headTitle = (
    <View style={styles.headerRow}>
      <View style={styles.headerTexts}>
        <Text variant="title1" weight="700">
          My Orders
        </Text>
        <Text variant="subhead" color="secondary" style={{ marginTop: 4 }}>
          Track and manage all your deliveries
        </Text>
      </View>
      <View style={styles.headerActions}>
        <Pressable
          testID="notifications-bell"
          onPress={() => showComingSoon('Notifications')}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={8}
          style={[styles.bellButton, { backgroundColor: colors.surface, borderColor: colors.hairline }, elevation.e1]}
        >
          <Feather name="bell" size={19} color={colors.azure} />
        </Pressable>
        {total > 0 ? (
          <Button testID="orders-see-all" label={`See all (${total})`} size="sm" fullWidth={false} onPress={scrollToTracking} style={{ marginLeft: space.sm }} />
        ) : null}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.canvas }]} testID="orders-loading">
        <View style={styles.list}>
          {headTitle}
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.canvas }]}>
        <View style={styles.list}>
          {headTitle}
          <Card style={styles.errorCard}>
            <Feather name="wifi-off" size={26} color={colors.textTertiary} />
            <Text variant="headline" weight="600" center style={{ marginTop: 10 }}>
              Couldn’t load your orders
            </Text>
            <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
              {error}
            </Text>
            <Button label="Try again" icon="refresh-cw" variant="outline" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <ScrollView
        testID="orders-list"
        ref={scrollRef}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.azure} colors={[colors.azure]} />}
      >
        {headTitle}

        {total === 0 ? (
          <Card style={styles.emptyCard}>
            <EmptyState
              testID="orders-empty"
              icon="package"
              title="No orders yet"
              body="Pick a service and we’ll collect, clean and deliver it back to you."
            />
            <Button
              testID="book-cta"
              label="Book a pickup"
              icon="plus"
              onPress={() => navigation.navigate('Services')}
              fullWidth={false}
              style={{ marginTop: 4, alignSelf: 'center', paddingHorizontal: 28 }}
            />
          </Card>
        ) : (
          <>
            {/* Compact order list — one continuous card, hairline-divided rows (§ spec). */}
            <Card padding={0} style={styles.listCard} testID="orders-compact-list">
              {orders.map((order, i) => (
                <React.Fragment key={order.id}>
                  <CompactOrderRow
                    order={order}
                    index={i}
                    onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                    onRate={() => navigation.navigate('Rate', { orderId: order.id })}
                  />
                  {i < orders.length - 1 ? <View style={[styles.rowDivider, { backgroundColor: colors.hairline }]} /> : null}
                </React.Fragment>
              ))}
            </Card>

            {/* Stats strip: Total / Completed / In Progress. */}
            <Card style={styles.statsCard} testID="orders-stats">
              <View style={styles.statsRow}>
                <StatTile testID="stat-total" value={String(total)} label="Total Orders" icon="package" iconTone="azure" style={styles.statTile} />
                <View style={[styles.statDivider, { backgroundColor: colors.hairline }]} />
                <StatTile
                  testID="stat-completed"
                  value={String(completedCount)}
                  label="Completed"
                  icon="calendar"
                  iconTone="success"
                  emphasize={completedCount > 0}
                  style={styles.statTile}
                />
                <View style={[styles.statDivider, { backgroundColor: colors.hairline }]} />
                <StatTile
                  testID="stat-in-progress"
                  value={String(inProgressCount)}
                  label="In Progress"
                  icon="clock"
                  iconTone="warning"
                  emphasize={inProgressCount > 0}
                  style={styles.statTile}
                />
              </View>
            </Card>

            {/* Real-time tracking section header (violet-wash Hero band, per render). */}
            <View onLayout={(e) => { trackingY.current = e.nativeEvent.layout.y; }}>
              <Hero style={styles.trackingHero} testID="tracking-hero">
                <View style={styles.trackingHeroRow}>
                  <IconBadge icon="package" tone="azure" size={44} />
                  <View style={styles.trackingHeroTexts}>
                    <Text variant="headline" weight="700">
                      My Orders
                    </Text>
                    <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
                      Track your orders in real-time
                    </Text>
                  </View>
                  <Pressable
                    testID="tracking-see-all"
                    onPress={scrollToEnd}
                    accessibilityRole="button"
                    accessibilityLabel="See all tracked orders"
                    hitSlop={6}
                    style={[styles.trackingSeeAll, { backgroundColor: colors.surface }]}
                  >
                    <Text variant="subhead" weight="600" color="azure">
                      See all ({trackedOrders.length})
                    </Text>
                    <Feather name="chevron-right" size={14} color={colors.azure} style={{ marginLeft: 4 }} />
                  </Pressable>
                </View>
              </Hero>
            </View>

            {trackedOrders.map((order, i) => (
              <TrackingCard key={order.id} order={order} index={i} onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })} />
            ))}

            {/* Trust strip — "Real-time Tracking" is real (scrolls up to the section above); the rest
                have no backing screen yet, so they're honest, tappable "coming soon" affordances rather
                than fabricated claims. */}
            <Card style={styles.trustCard}>
              <View style={styles.trustRow}>
                <TrustItem testID="trust-tracking" icon="radio" tone="honey" title="Real-time Tracking" subtitle="Live updates" onPress={scrollToTracking} />
                <TrustItem
                  testID="trust-secure"
                  icon="shield"
                  tone="azure"
                  title="Secure & Safe"
                  subtitle="Your orders are protected"
                  onPress={() => showComingSoon('Secure & Safe')}
                />
                <TrustItem
                  testID="trust-support"
                  icon="headphones"
                  tone="success"
                  title="24/7 Support"
                  subtitle="We’re here to help"
                  onPress={() => showComingSoon('24/7 Support')}
                />
                <TrustItem
                  testID="trust-returns"
                  icon="star"
                  tone="warning"
                  title="Easy Returns"
                  subtitle="Hassle-free returns"
                  onPress={() => showComingSoon('Easy Returns')}
                />
              </View>
            </Card>

            <Button testID="book-cta" label="Book a pickup" icon="plus" onPress={() => navigation.navigate('Services')} style={{ marginTop: 4 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** One row of the compact order list — icon chip, ref + date/time, the 4-stage pill, price, chevron.
 *  Every order renders here (the exhaustive list); the rate footer preserves the exact frozen
 *  testIDs/wiring (`rate-${id}`, `card-rating-${id}`) from the previous per-card layout. */
function CompactOrderRow({
  order,
  index,
  onPress,
  onRate,
}: {
  order: OrderSummary;
  index: number;
  onPress: () => void;
  onRate: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const press = usePressScale(true);
  const entrance = useEntrance(index);
  const view = customerStatus(order.status);
  const tone = toTone(view.tone);
  const { amount, suffix } = priceParts(order);

  return (
    <Animated.View style={{ opacity: entrance.opacity, transform: entrance.transform }}>
      <Pressable
        testID={`order-row-${order.id}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`Order ${orderRef(order.id)}, ${view.label}`}
      >
        <Animated.View style={[styles.rowWrap, { transform: press.transform }]}>
          <IconBadge icon={stageIcon(view.tone)} tone={tone} size={44} />
          <View style={styles.rowMeta}>
            <Text variant="headline" weight="700" mono numberOfLines={1}>
              {orderRef(order.id)}
            </Text>
            <View style={styles.rowMetaLine}>
              <Feather name="calendar" size={11} color={colors.textTertiary} />
              <Text variant="caption" color="secondary" style={styles.rowMetaText}>
                {shortDate(order.createdAt)}
              </Text>
            </View>
            <View style={styles.rowMetaLine}>
              <Feather name="clock" size={11} color={colors.textTertiary} />
              <Text variant="caption" color="secondary" style={styles.rowMetaText}>
                {shortTime(order.createdAt)}
              </Text>
            </View>
          </View>
          <Badge label={view.label} tone={tone as BadgeTone} dot={view.tone === 'transit'} style={styles.rowPill} />
          <View style={styles.rowPrice}>
            <Text variant="subhead" weight="700" tabular numberOfLines={1}>
              {amount}
            </Text>
            {suffix ? (
              <Text variant="caption" color="secondary" numberOfLines={1}>
                {suffix}
              </Text>
            ) : null}
          </View>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} style={{ marginLeft: 4 }} />
        </Animated.View>
      </Pressable>

      {/* [Inc-32] Rate affordance on delivered orders — the submitted score, or a tap-to-rate chip. */}
      {isRateable(order) ? (
        order.rating ? (
          <View style={[styles.rateFooter, { borderTopColor: colors.hairline }]}>
            <StarRating value={order.rating.score} size={13} testID={`card-rating-${order.id}`} />
            <Text variant="caption" color="secondary" style={{ marginLeft: 8 }}>
              Your rating
            </Text>
          </View>
        ) : (
          <Pressable
            testID={`rate-${order.id}`}
            onPress={onRate}
            accessibilityRole="button"
            accessibilityLabel="Rate this order"
            style={[styles.rateFooter, { borderTopColor: colors.hairline }]}
            hitSlop={6}
          >
            <Feather name="star" size={13} color={colors.honey} />
            <Text variant="caption" weight="600" color="azure" style={{ marginLeft: 8 }}>
              Rate this order
            </Text>
          </Pressable>
        )
      ) : null}
    </Animated.View>
  );
}

/**
 * A per-order "real-time tracking" card — colored left border (the customer's current-stage tone) +
 * the 4-node horizontal timeline, matching the render's tracking section.
 */
function TrackingCard({ order, index, onPress }: { order: OrderSummary; index: number; onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const press = usePressScale(true);
  const entrance = useEntrance(index);
  const view = customerStatus(order.status);
  const tone = toTone(view.tone);
  const timeline = buildCustomerTimeline(order.status);
  const { amount, suffix } = priceParts(order);
  const borderColor = toneHex(tone, colors);

  return (
    <Animated.View style={{ opacity: entrance.opacity, transform: entrance.transform }}>
      <Pressable
        testID={`order-tracking-${order.id}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`Track order ${orderRef(order.id)}`}
      >
        <Animated.View style={{ transform: press.transform }}>
          <Card style={[styles.trackingCard, { borderLeftWidth: 4, borderLeftColor: borderColor }]}>
            <View style={styles.trackingTop}>
              <IconBadge icon={stageIcon(view.tone)} tone={tone} size={36} />
              <View style={styles.trackingMeta}>
                <Text variant="subhead" weight="700" mono numberOfLines={1}>
                  {orderRef(order.id)}
                </Text>
                <Text variant="caption" color="secondary" style={{ marginTop: 2 }} numberOfLines={1}>
                  {shortDate(order.createdAt)} · {shortTime(order.createdAt)}
                </Text>
              </View>
              <Badge label={view.label.toUpperCase()} tone={tone as BadgeTone} dot={view.tone === 'transit'} />
            </View>
            <View style={styles.trackingPriceRow}>
              <View style={styles.rowPrice}>
                <Text variant="subhead" weight="700" tabular>
                  {amount}
                </Text>
                {suffix ? (
                  <Text variant="caption" color="secondary">
                    {suffix}
                  </Text>
                ) : null}
              </View>
              <Feather name="chevron-down" size={16} color={colors.textTertiary} />
            </View>
            <TrackingTimeline timeline={timeline} tone={tone} testID={`order-tracker-${order.id}`} />
          </Card>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The 4-node horizontal customer timeline (placed → picked up → out for delivery → delivered), driven
 * entirely by `buildCustomerTimeline`'s done/current/upcoming state — never a client-invented status.
 * No per-node timestamps: the order-list payload doesn't carry per-milestone times (only the detail
 * screen's route-stop data does), so we show state, not a fabricated clock.
 */
function TrackingTimeline({ timeline, tone, testID }: { timeline: CustomerTimeline; tone: IconTone; testID?: string }): React.ReactElement {
  const { colors } = useTheme();
  const activeColor = toneHex(tone, colors);
  const currentLabel = timeline.steps.find((s) => s.state === 'current')?.label ?? timeline.steps[timeline.steps.length - 1]?.label ?? '';

  return (
    <View
      style={[styles.trackerRow, { borderTopColor: colors.hairline }]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={`Order status: ${currentLabel}`}
    >
      {timeline.steps.map((step, i) => {
        const done = step.state === 'done';
        const current = step.state === 'current';
        const isFinal = i === timeline.steps.length - 1;
        const filled = done || (current && isFinal);
        const nodeColor = done ? colors.azure : current ? activeColor : colors.surface;
        const nodeBorder = done ? colors.azure : current ? activeColor : colors.hairline;
        const labelColor = current ? colors.text : done ? colors.textSecondary : colors.textTertiary;
        const connectorColor = done ? colors.azure : colors.hairline;
        return (
          <React.Fragment key={step.label}>
            <View style={styles.trackerStep}>
              <View style={[styles.trackerDot, { backgroundColor: nodeColor, borderColor: nodeBorder }]}>
                {filled ? <Feather name="check" size={10} color={colors.onAzure} /> : current ? <View style={[styles.trackerDotCore, { backgroundColor: colors.onAzure }]} /> : null}
              </View>
              <Text variant="caption" weight={current ? '700' : '500'} numberOfLines={1} style={{ color: labelColor, marginTop: 4 }}>
                {step.label}
              </Text>
            </View>
            {i < timeline.steps.length - 1 ? <View style={[styles.trackerConnector, { backgroundColor: connectorColor }]} /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** One trust-strip chip — a colored icon chip + bold title + muted subtitle. Real destinations where
 *  they exist (Real-time Tracking scrolls to the live section above); an honest "coming soon" tap
 *  everywhere else — never a fabricated claim with no feature behind it. */
function TrustItem({
  icon,
  tone,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: FeatherName;
  tone: IconTone;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={title} hitSlop={4} style={styles.trustItem}>
      <IconBadge icon={icon} tone={tone} size={34} />
      <Text variant="caption" weight="700" style={{ marginTop: 6 }} numberOfLines={1}>
        {title}
      </Text>
      <Text variant="caption" color="secondary" numberOfLines={2} style={{ marginTop: 1 }}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, flexGrow: 1 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  headerTexts: { flex: 1, paddingRight: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyCard: { marginTop: 8 },
  errorCard: { alignItems: 'center', paddingVertical: 28 },

  listCard: { overflow: 'hidden', marginBottom: 14 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  rowDivider: { height: StyleSheet.hairlineWidth },
  rowMeta: { flex: 1, marginLeft: 12, marginRight: 8 },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  rowMetaText: { marginLeft: 4 },
  rowPill: { marginRight: 10 },
  rowPrice: { alignItems: 'flex-end' },
  rateFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  statsCard: { marginBottom: 14 },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statTile: { flex: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 2 },

  trackingHero: { marginBottom: 14 },
  trackingHeroRow: { flexDirection: 'row', alignItems: 'center' },
  trackingHeroTexts: { flex: 1, marginLeft: 12 },
  trackingSeeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },

  trackingCard: { marginBottom: 12 },
  trackingTop: { flexDirection: 'row', alignItems: 'center' },
  trackingMeta: { flex: 1, marginLeft: 10, marginRight: 8 },
  trackingPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },

  trackerRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  trackerStep: { flex: 1, alignItems: 'center' },
  trackerDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  trackerDotCore: { width: 6, height: 6, borderRadius: 3 },
  trackerConnector: { flex: 0.5, height: 2, borderRadius: 1, marginTop: 9 },

  trustCard: { marginTop: 4 },
  trustRow: { flexDirection: 'row', flexWrap: 'wrap' },
  trustItem: { width: '50%', paddingVertical: 8, paddingRight: 8 },
});
