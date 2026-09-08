import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { OrderStatus } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useFocusEffect, type RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { OrderDetail } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { money, orderRef, shortDate, shortTime } from '../format';
import { Badge, Card, ErrorBox, Loading, Row, type Tone } from '../components/ui';
import { Button, Text, useTheme, haptics } from '@blue-bee/ui';
import { Screen } from '../components/kit';

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
  const t = useTheme();
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
    async (fn: () => Promise<OrderDetail>, okMsg: string, success: boolean): Promise<void> => {
      setActing(true);
      setActionMsg(null);
      try {
        setOrder(await fn());
        if (success) haptics.success();
        else haptics.warning();
        setActionMsg(okMsg);
      } catch (e) {
        // 409 = the server's atomic claim moved (expired / already acted) → re-sync to the truth.
        if (e instanceof ApiError && e.isConflict) {
          await load();
          haptics.warning();
          setActionMsg(e.message || 'This quote changed — refreshed to the latest.');
        } else {
          haptics.error();
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
    <Screen scroll testID="order-detail">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title1" mono>
          {orderRef(order.id)}
        </Text>
        <Badge tone="blue">{humanize(order.status)}</Badge>
      </View>
      <Text variant="footnote" color={t.colors.textSecondary} style={{ marginTop: 4 }}>
        Booked {shortDate(order.createdAt)}
      </Text>

      {quote ? (
        <Card title="Quote">
          <Row label="Subtotal" value={money(quote.subtotal, order.totals?.currency)} />
          <Row label="Tax" value={money(quote.tax, order.totals?.currency)} />
          <Row label="Total" value={money(quote.total, order.totals?.currency)} bold />
          {quote.expiresAt ? (
            <Text variant="caption" color={t.colors.textTertiary} style={{ marginTop: 6 }}>
              Valid until {shortDate(quote.expiresAt)}
            </Text>
          ) : null}
          {pay ? (
            <View style={{ marginTop: 10 }}>
              <Badge tone={paymentTone(pay)}>{humanize(pay)}</Badge>
            </View>
          ) : null}

          {isQuoted ? (
            <View style={{ marginTop: 14, gap: 10 }}>
              <Button
                testID="approve-quote"
                label="Approve quote"
                icon="check-circle"
                onPress={() => void act(() => client.approveQuote(orderId), 'Quote approved — work can start.', true)}
                busy={acting}
                disabled={acting}
                size="md"
                haptic="none"
                fullWidth
              />
              <Button
                testID="decline-quote"
                label="Decline"
                onPress={() => void act(() => client.declineQuote(orderId), 'Quote declined.', false)}
                disabled={acting}
                tone="neutral"
                variant="outline"
                size="md"
                haptic="none"
                fullWidth
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card title="Chain of custody">
        {order.items.length === 0 ? (
          <Text variant="subhead" color={t.colors.textSecondary}>
            No items yet.
          </Text>
        ) : (
          order.items.map((it) => (
            <View key={it.id} style={{ marginBottom: 14 }} testID={`item-${it.id}`}>
              <Text variant="subhead" weight="700" style={{ marginBottom: 8 }}>
                {it.kind} · {humanize(it.status)}
              </Text>
              {it.custodyEvents.length === 0 ? (
                <Text variant="footnote" color={t.colors.textSecondary}>
                  No scans yet.
                </Text>
              ) : (
                it.custodyEvents
                  .slice()
                  .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))
                  .map((c) => (
                    <View
                      key={c.id}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingVertical: 5,
                        borderLeftWidth: 2,
                        borderLeftColor: t.colors.success,
                        paddingLeft: 12,
                        marginLeft: 4,
                      }}
                    >
                      <Text variant="footnote">{humanize(c.stage)}</Text>
                      <Text variant="caption" color={t.colors.textTertiary} mono tabular>
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
        <Text testID="action-msg" variant="subhead" color={t.colors.textSecondary} center style={{ marginTop: 14 }}>
          {actionMsg}
        </Text>
      ) : null}
    </Screen>
  );
}
