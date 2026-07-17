import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Animated, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import { ApiError } from '@blue-bee/api-client';
import { OrderStatus } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { OrderSummary } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { money, orderRef, rangeText, shortDate } from '../format';
import { isRateable } from '../orders/rating';
import { StarRating } from '../components/StarRating';
import { useTheme, usePressScale, useEntrance } from '../../theme';
import { Button, Card, EmptyState, Hero, SkeletonCard, StatTile, StatusPill, Text } from '../../components/ui';

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

/** The compact 4-milestone customer read of an order in motion (distinct from the full §5.1 spine used
 *  on the detail screen) — placed → picked up → out for delivery → delivered, driven by `order.status`.
 *  Declined / closed-without-work orders never reached the happy path, so they get no tracker at all
 *  (their StatusPill already tells the honest story). */
const TRACKER_LABELS = ['Placed', 'Picked up', 'Out for delivery', 'Delivered'];

function trackerStep(status: OrderStatus): number | null {
  switch (status) {
    case OrderStatus.REQUESTED:
    case OrderStatus.SCHEDULED_PICKUP:
      return 0;
    case OrderStatus.PICKUP_EN_ROUTE:
    case OrderStatus.PICKED_UP:
    case OrderStatus.INTAKE_INSPECTED:
    case OrderStatus.DAMAGE_PREEXISTING_FLAGGED:
    case OrderStatus.QUOTED:
    case OrderStatus.QUOTE_APPROVED:
    case OrderStatus.IN_CLEANING:
    case OrderStatus.REWASH:
    case OrderStatus.QC:
    case OrderStatus.READY:
    case OrderStatus.SCHEDULED_DELIVERY:
    case OrderStatus.ON_HOLD:
      return 1;
    case OrderStatus.DELIVERY_EN_ROUTE:
      return 2;
    case OrderStatus.DELIVERED:
    case OrderStatus.INVOICED:
    case OrderStatus.CLOSED:
    case OrderStatus.CLAIM_OPENED:
    case OrderStatus.CLAIM_RESOLVED:
      return 3;
    default:
      return null; // QUOTE_DECLINED, CLOSED_NO_WORK — no happy-path progress to show
  }
}

/** "My orders" (PRD §7A) — the customer's own orders, row-scoped server-side (GET /v1/orders). */
export function OrdersScreen({ navigation }: { navigation: NavigationProp<RootStackParamList> }): React.ReactElement {
  const { client, me } = useSession();
  const { colors, space } = useTheme();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const firstName = me?.user.name ? me.user.name.split(' ')[0] : null;

  // Stats strip — counts derived ONLY from the orders already loaded on screen, never a separate number.
  const total = orders.length;
  const completedCount = orders.reduce((n, o) => (COMPLETED_STATUSES.has(o.status) ? n + 1 : n), 0);
  const inProgressCount = total - completedCount;

  const header = (
    <View style={styles.headerWrap}>
      <Hero testID="orders-hero">
        <Text variant="title3" weight="700">
          {firstName ? `Hi, ${firstName} 👋` : 'Welcome back 👋'}
        </Text>
        <Text variant="subhead" color="secondary" style={{ marginTop: 4 }}>
          Your specialty cleaning, tracked door to door.
        </Text>
        {/* [Inc-36] Booking now always starts from a service card, so this sends the customer to the Service
            grid to pick one — it no longer opens the general composer. */}
        <Button testID="book-cta" label="Book a pickup" icon="plus" onPress={() => navigation.navigate('Services')} style={{ marginTop: space.lg }} />
      </Hero>

      {total > 0 ? (
        <Card testID="orders-stats" style={styles.statsCard}>
          <View style={styles.statsRow}>
            <StatTile testID="stat-total" value={String(total)} label="Total orders" icon="package" iconTone="azure" style={styles.statTile} />
            <StatTile
              testID="stat-in-progress"
              value={String(inProgressCount)}
              label="In progress"
              icon="truck"
              iconTone="warning"
              emphasize={inProgressCount > 0}
              style={styles.statTile}
            />
            <StatTile
              testID="stat-completed"
              value={String(completedCount)}
              label="Completed"
              icon="check-circle"
              iconTone="success"
              emphasize={completedCount > 0}
              style={styles.statTile}
            />
          </View>
        </Card>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.canvas }]} testID="orders-loading">
        {header}
        <View style={styles.list}>
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
        {header}
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
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <FlatList
        testID="orders-list"
        data={orders}
        keyExtractor={(o) => o.id}
        renderItem={({ item, index }) => (
          <OrderCard
            order={item}
            index={index}
            onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
            onRate={() => navigation.navigate('Rate', { orderId: item.id })}
          />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.azure} colors={[colors.azure]} />}
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <EmptyState
              testID="orders-empty"
              icon="package"
              title="No orders yet"
              body="Pick a service and we’ll collect, clean and deliver it back to you."
              actionLabel="Choose a service"
              actionIcon="plus"
              onAction={() => navigation.navigate('Services')}
            />
          </Card>
        }
      />
    </View>
  );
}

function OrderCard({ order, index, onPress, onRate }: { order: OrderSummary; index: number; onPress: () => void; onRate: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const press = usePressScale(true);
  const entrance = useEntrance(index);

  const latestQuote = order.quotes?.[0];
  const priceLine = latestQuote?.total
    ? money(latestQuote.total, order.totals?.currency)
    : order.totals?.estimateRange
      ? `${rangeText(order.totals.estimateRange.low, order.totals.estimateRange.high, order.totals.estimateRange.currency)} · est.`
      : '—';

  // Only orders still on the happy path (< step 3 = delivered) get the compact tracker — once delivered,
  // the StatusPill + rate footer below already tell the story, so we don't show a redundant "all done" bar.
  const step = trackerStep(order.status);
  const showTracker = step != null && step < 3;

  return (
    <Animated.View style={{ opacity: entrance.opacity, transform: entrance.transform }}>
      <Pressable
        testID={`order-row-${order.id}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`Order ${orderRef(order.id)}`}
      >
        <Animated.View style={{ transform: press.transform }}>
          <Card style={styles.card}>
            <View style={styles.cardTop}>
              <Text variant="headline" weight="700" mono>
                {orderRef(order.id)}
              </Text>
              <StatusPill status={order.status} />
            </View>
            <View style={styles.cardBottom}>
              <Text variant="subhead" color="secondary" tabular>
                {shortDate(order.createdAt)}
              </Text>
              <View style={styles.priceRow}>
                <Text variant="subhead" weight="600" tabular>
                  {priceLine}
                </Text>
                <Feather name="chevron-right" size={18} color={colors.textTertiary} style={{ marginLeft: 6 }} />
              </View>
            </View>

            {/* [Royal restyle] Real-time tracking treatment for active orders — placed → picked up →
                out for delivery → delivered, driven entirely by the server's `order.status`. */}
            {showTracker ? <MiniTracker current={step!} testID={`order-tracker-${order.id}`} /> : null}

            {/* [Inc-32] Rate affordance on delivered orders — the submitted score, or a tap-to-rate chip. */}
            {isRateable(order) ? (
              order.rating ? (
                <View style={[styles.rateFooter, { borderTopColor: colors.hairline }]}>
                  <StarRating value={order.rating.score} size={14} testID={`card-rating-${order.id}`} />
                  <Text variant="footnote" color="secondary" style={{ marginLeft: 8 }}>
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
                  <Feather name="star" size={14} color={colors.honey} />
                  <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 8 }}>
                    Rate this order
                  </Text>
                </Pressable>
              )
            ) : null}
          </Card>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A compact, edge-flexible 4-node horizontal timeline (placed → picked up → out for delivery →
 * delivered). Every segment is `flex: 1` — unlike a fixed-width stepper this always fits the card's
 * width exactly, on any device. Colour language: azure = scheduled/in-motion, warning/amber = out for
 * delivery; a step already passed is always azure (only the live "out for delivery" node ever turns
 * amber), matching the StatusPill tones used across the rest of the app.
 */
function MiniTracker({ current, testID }: { current: number; testID?: string }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.trackerRow, { borderTopColor: colors.hairline }]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={`Order status: ${TRACKER_LABELS[current]}`}
    >
      {TRACKER_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const amber = active && i === 2;
        const toneColor = amber ? colors.warning : colors.azure;
        const nodeBg = done ? colors.azure : active ? toneColor : colors.surface;
        const nodeBorder = done || active ? toneColor : colors.hairline;
        const labelColor = active ? colors.text : done ? colors.textSecondary : colors.textTertiary;
        const connectorColor = i < current ? colors.azure : colors.hairline;
        return (
          <React.Fragment key={label}>
            <View style={styles.trackerStep}>
              <View style={[styles.trackerDot, { backgroundColor: nodeBg, borderColor: nodeBorder }]}>
                {done ? <Feather name="check" size={10} color={colors.onAzure} /> : null}
              </View>
              <Text variant="caption" weight={active ? '700' : '500'} numberOfLines={1} style={{ color: labelColor, marginTop: 4 }}>
                {label}
              </Text>
            </View>
            {i < TRACKER_LABELS.length - 1 ? <View style={[styles.trackerConnector, { backgroundColor: connectorColor }]} /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrap: { paddingTop: 12, paddingBottom: 4 },
  list: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
  statsCard: { marginTop: 14 },
  statsRow: { flexDirection: 'row' },
  statTile: { flex: 1 },
  emptyCard: { marginTop: 8 },
  card: { marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  rateFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  errorCard: { marginHorizontal: 20, alignItems: 'center', paddingVertical: 28 },
  trackerRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  trackerStep: { flex: 1, alignItems: 'center' },
  trackerDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  trackerConnector: { flex: 0.5, height: 2, borderRadius: 1, marginTop: 8 },
});
