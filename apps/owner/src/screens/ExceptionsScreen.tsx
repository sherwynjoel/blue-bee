import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import type { OwnerException, OwnerExceptionKind } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { useAsync } from '../useAsync';
import { money, timeAgo } from '../format';
import { EmptyState, ErrorBox, Loading } from '../components/ui';
import { Badge, Row, Segmented, Text, useTheme, type FeatherName, type Tone } from '../components/kit';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;

const KIND_META: Record<OwnerExceptionKind, { tone: Tone; label: string; icon: FeatherName }> = {
  STOP_FAILED: { tone: 'danger', label: 'Failed stop', icon: 'x-circle' },
  STOP_SKIPPED: { tone: 'warning', label: 'Skipped stop', icon: 'skip-forward' },
  ORDER_HELD: { tone: 'warning', label: 'On hold', icon: 'pause-circle' },
  PAYMENT_DISPUTE: { tone: 'danger', label: 'Dispute', icon: 'alert-octagon' },
  PAYMENT_FAILED: { tone: 'danger', label: 'Payment failed', icon: 'credit-card' },
};

type Filter = 'all' | 'stops' | 'orders' | 'payments';

const GROUP: Record<OwnerExceptionKind, Exclude<Filter, 'all'>> = {
  STOP_FAILED: 'stops',
  STOP_SKIPPED: 'stops',
  ORDER_HELD: 'orders',
  PAYMENT_DISPUTE: 'payments',
  PAYMENT_FAILED: 'payments',
};

const FILTERS: ReadonlyArray<{ label: string; value: Filter }> = [
  { label: 'All', value: 'all' },
  { label: 'Stops', value: 'stops' },
  { label: 'Orders', value: 'orders' },
  { label: 'Payments', value: 'payments' },
];

/**
 * Exceptions feed (PRD §7C C4) — the things needing the owner's attention: failed/skipped stops, held
 * orders, open disputes, failed payments — server-aggregated + normalized (`GET /owner/exceptions`),
 * newest first, with a by-type segmented filter. Each row deep-links to the underlying object: a stop
 * exception → its route; everything else → the order detail. Read-only drill (§7C C5).
 */
export function ExceptionsScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const t = useTheme();
  const { client } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.exceptions(), [client]);
  const [filter, setFilter] = useState<Filter>('all');

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loading && !data) return <Loading label="Loading exceptions…" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const exceptions = data?.exceptions ?? [];
  if (exceptions.length === 0) {
    return <EmptyState testID="exceptions-empty" message="Nothing needs your attention right now." />;
  }

  const filtered = filter === 'all' ? exceptions : exceptions.filter((e) => GROUP[e.kind] === filter);

  const open = (item: OwnerException): void => {
    if (item.routeId) {
      navigation.navigate('RouteDetail', { routeId: item.routeId, title: 'Stop exception' });
    } else if (item.orderId) {
      navigation.navigate('OrderDetail', { orderId: item.orderId });
    }
  };

  return (
    <FlatList
      testID="exceptions-list"
      style={{ flex: 1, backgroundColor: t.color.canvas }}
      contentContainerStyle={{ padding: t.spacing.lg }}
      data={filtered}
      keyExtractor={(e) => `${e.kind}:${e.id}`}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={t.color.azure} />}
      ListHeaderComponent={
        <View style={{ marginBottom: t.spacing.md }}>
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        </View>
      }
      ListEmptyComponent={
        <Text variant="subhead" color={t.color.textMuted} center style={{ marginTop: t.spacing.xl }}>
          Nothing in this group.
        </Text>
      }
      renderItem={({ item }) => <ExceptionRow item={item} onPress={() => open(item)} />}
    />
  );
}

function ExceptionRow({ item, onPress }: { item: OwnerException; onPress: () => void }): React.ReactElement {
  const t = useTheme();
  const meta = KIND_META[item.kind];
  const tappable = !!item.routeId || !!item.orderId;
  return (
    <Row testID={`exception-${item.id}`} onPress={tappable ? onPress : undefined} disabled={!tappable} chevron={tappable} style={{ marginBottom: t.spacing.md }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Badge tone={meta.tone} icon={meta.icon}>
            {meta.label}
          </Badge>
          <Text variant="caption" color={t.color.textFaint} tabular>
            {timeAgo(item.occurredAt)}
          </Text>
        </View>
        <Text variant="headline" numberOfLines={2}>
          {item.title}
        </Text>
        {item.detail ? (
          <Text variant="footnote" color={t.color.textMuted}>
            {item.detail}
          </Text>
        ) : null}
        {item.amount ? (
          <Text variant="subhead" weight="700" color={t.color.dangerInk} mono tabular>
            {money(item.amount, item.currency ?? undefined)}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}
