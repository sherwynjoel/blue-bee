import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Animated, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';
import type { OrderSummary } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { money, orderRef, rangeText, shortDate } from '../format';
import { isRateable } from '../orders/rating';
import { StarRating } from '../components/StarRating';
import { useTheme, usePressScale, useEntrance } from '../../theme';
import { Button, Card, EmptyState, SkeletonCard, StatusPill, Text } from '../../components/ui';

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

  const header = (
    <View style={styles.headerWrap}>
      <Text variant="title3" weight="600">
        {firstName ? `Hi, ${firstName} 👋` : 'Welcome back 👋'}
      </Text>
      <Text variant="subhead" color="secondary" style={{ marginTop: 2 }}>
        Your specialty cleaning, tracked door to door.
      </Text>
      <Button testID="book-cta" label="Book a specialty cleaning" icon="plus" onPress={() => navigation.navigate('Book')} style={{ marginTop: space.lg }} />
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
          <EmptyState
            icon="package"
            title="No orders yet"
            body="Book your first specialty pickup and we’ll track it door to door."
            actionLabel="Book a pickup"
            actionIcon="plus"
            onAction={() => navigation.navigate('Book')}
          />
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrap: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
  card: { marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  rateFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  errorCard: { marginHorizontal: 20, alignItems: 'center', paddingVertical: 28 },
});
