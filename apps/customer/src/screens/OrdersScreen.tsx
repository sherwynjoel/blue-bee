import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';
import type { OrderSummary } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { statusLabel } from '../orders/timeline';
import { money, orderRef, rangeText, shortDate } from '../format';

/** "My orders" (PRD §7A) — the customer's own orders, row-scoped server-side (GET /v1/orders). */
export function OrdersScreen({ navigation }: { navigation: NavigationProp<RootStackParamList> }): React.ReactElement {
  const { client, logout, me } = useSession();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const result = await client.listOrders({ limit: 50 });
      setOrders(result.orders);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your orders.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const renderRow = ({ item }: { item: OrderSummary }) => {
    const latestQuote = item.quotes?.[0];
    const priceLine = latestQuote?.total
      ? money(latestQuote.total, item.totals?.currency)
      : item.totals?.estimateRange
        ? `${rangeText(item.totals.estimateRange.low, item.totals.estimateRange.high, item.totals.estimateRange.currency)} (est.)`
        : '—';
    return (
      <TouchableOpacity
        testID={`order-row-${item.id}`}
        style={styles.row}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
      >
        <View style={styles.rowTop}>
          <Text style={styles.ref}>{orderRef(item.id)}</Text>
          <Text style={styles.badge}>{statusLabel(item.status)}</Text>
        </View>
        <Text style={styles.meta}>
          {shortDate(item.createdAt)} · {priceLine}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.hello}>Hi{me?.user.name ? `, ${me.user.name.split(' ')[0]}` : ''}</Text>
        <TouchableOpacity testID="logout" onPress={() => void logout()}>
          <Text style={styles.link}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity testID="book-cta" style={styles.bookCta} onPress={() => navigation.navigate('Book')}>
        <Text style={styles.bookCtaText}>+ Book a specialty cleaning</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator testID="orders-loading" style={styles.center} size="large" color="#1f6feb" />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity onPress={() => void load()}>
            <Text style={styles.link}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          testID="orders-list"
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderRow}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}
          ListEmptyComponent={<Text style={styles.empty}>No orders yet. Book your first specialty cleaning above.</Text>}
          contentContainerStyle={orders.length === 0 ? styles.center : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa', padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  hello: { fontSize: 22, fontWeight: '700', color: '#1f2328' },
  link: { color: '#1f6feb', fontSize: 15 },
  bookCta: { backgroundColor: '#1f6feb', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 16 },
  bookCtaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#eaeef2' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontSize: 16, fontWeight: '700', color: '#1f2328' },
  badge: { fontSize: 13, color: '#0969da', fontWeight: '600' },
  meta: { color: '#57606a', marginTop: 6 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  empty: { color: '#57606a', textAlign: 'center', paddingHorizontal: 24 },
  error: { color: '#b91c1c', textAlign: 'center' },
});
