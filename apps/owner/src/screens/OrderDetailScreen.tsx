import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { OrderStatus } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useFocusEffect, type RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { OrderDetail } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { money, orderRef, shortDate, shortTime } from '../format';
import { Badge, Card, ErrorBox, Loading, Row, type Tone } from '../components/ui';

type Route = RouteProp<RootStackParamList, 'OrderDetail'>;

function humanize(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
function paymentTone(s?: string): Tone {
  return s === 'PAID' ? 'green' : s === 'FAILED' ? 'red' : s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED' ? 'amber' : 'gray';
}

/**
 * Order drill-through (PRD §7C C5) — read-only into the same object the console shows: the §5.1 status,
 * the quote, the finance state, and the append-only CHAIN OF CUSTODY per item (PRD §8.2). When the
 * order is awaiting approval (QUOTED) the owner can approve/decline here via the proven, server-
 * authoritative `quote:approve|:decline` — a 409 (the quote moved/expired) re-syncs to the truth.
 */
export function OrderDetailScreen({ route }: { route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setOrder(await client.getOrder(orderId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [client, orderId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = useCallback(
    async (fn: () => Promise<OrderDetail>, okMsg: string): Promise<void> => {
      setActing(true);
      setActionMsg(null);
      try {
        setOrder(await fn());
        setActionMsg(okMsg);
      } catch (e) {
        // 409 = the server's atomic claim moved (expired / already acted) → re-sync to the truth.
        if (e instanceof ApiError && e.isConflict) {
          await load();
          setActionMsg(e.message || 'This quote changed — refreshed to the latest.');
        } else {
          setActionMsg(e instanceof ApiError ? e.message : 'That action could not be completed.');
        }
      } finally {
        setActing(false);
      }
    },
    [load],
  );

  if (loading && !order) return <Loading label="Loading order…" />;
  if ((error && !order) || !order) return <ErrorBox message={error ?? 'Order not found.'} onRetry={() => void load()} />;

  const quote = order.quotes.find((q) => q.status === 'SENT') ?? order.quotes[order.quotes.length - 1];
  const isQuoted = order.status === OrderStatus.QUOTED;
  const pay = order.totals?.paymentStatus;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="order-detail">
      <View style={styles.headerRow}>
        <Text style={styles.ref}>{orderRef(order.id)}</Text>
        <Badge tone="blue">{humanize(order.status)}</Badge>
      </View>
      <Text style={styles.sub}>Booked {shortDate(order.createdAt)}</Text>

      {quote ? (
        <Card title="Quote">
          <Row label="Subtotal" value={money(quote.subtotal, order.totals?.currency)} />
          <Row label="Tax" value={money(quote.tax, order.totals?.currency)} />
          <Row label="Total" value={money(quote.total, order.totals?.currency)} bold />
          {quote.expiresAt ? <Text style={styles.muted}>Valid until {shortDate(quote.expiresAt)}</Text> : null}
          {pay ? (
            <View style={{ marginTop: 8 }}>
              <Badge tone={paymentTone(pay)}>{humanize(pay)}</Badge>
            </View>
          ) : null}

          {isQuoted ? (
            <View style={styles.actions}>
              <TouchableOpacity
                testID="approve-quote"
                style={[styles.approveBtn, acting && styles.btnDisabled]}
                onPress={() => void act(() => client.approveQuote(orderId), 'Quote approved — work can start.')}
                disabled={acting}
              >
                {acting ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>Approve quote</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                testID="decline-quote"
                style={styles.declineBtn}
                onPress={() => void act(() => client.declineQuote(orderId), 'Quote declined.')}
                disabled={acting}
              >
                <Text style={styles.declineText}>Decline</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card title="Chain of custody">
        {order.items.length === 0 ? (
          <Text style={styles.muted}>No items yet.</Text>
        ) : (
          order.items.map((it) => (
            <View key={it.id} style={styles.itemBlock} testID={`item-${it.id}`}>
              <Text style={styles.itemTitle}>
                {it.kind} · {humanize(it.status)}
              </Text>
              {it.custodyEvents.length === 0 ? (
                <Text style={styles.muted}>No scans yet.</Text>
              ) : (
                it.custodyEvents
                  .slice()
                  .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))
                  .map((c) => (
                    <View key={c.id} style={styles.custodyRow}>
                      <Text style={styles.custodyStage}>{humanize(c.stage)}</Text>
                      <Text style={styles.custodyTime}>
                        {shortDate(c.occurredAt)} {shortTime(c.occurredAt)}
                      </Text>
                    </View>
                  ))
              )}
            </View>
          ))
        )}
      </Card>

      {actionMsg ? (
        <Text testID="action-msg" style={styles.actionMsg}>
          {actionMsg}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontSize: 22, fontWeight: '700', color: '#1f2328' },
  sub: { color: '#57606a', marginTop: 4 },
  muted: { color: '#57606a', marginTop: 4 },
  actions: { marginTop: 14, gap: 8 },
  approveBtn: { backgroundColor: '#1f883d', borderRadius: 8, padding: 14, alignItems: 'center' },
  approveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  declineBtn: { borderWidth: 1, borderColor: '#cf222e', borderRadius: 8, padding: 12, alignItems: 'center' },
  declineText: { color: '#cf222e', fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  itemBlock: { marginBottom: 14 },
  itemTitle: { fontWeight: '700', color: '#1f2328', marginBottom: 6 },
  custodyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderLeftWidth: 2, borderLeftColor: '#dafbe1', paddingLeft: 10, marginLeft: 4 },
  custodyStage: { color: '#1f2328' },
  custodyTime: { color: '#8c959f', fontSize: 12 },
  actionMsg: { textAlign: 'center', color: '#1f2328', marginTop: 14, fontStyle: 'italic' },
});
