import React, { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import type { OwnerException, OwnerExceptionKind } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { useAsync } from '../useAsync';
import { money, timeAgo } from '../format';
import { Badge, EmptyState, ErrorBox, Loading, type Tone } from '../components/ui';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;

const KIND_META: Record<OwnerExceptionKind, { tone: Tone; label: string }> = {
  STOP_FAILED: { tone: 'red', label: 'Failed stop' },
  STOP_SKIPPED: { tone: 'amber', label: 'Skipped stop' },
  ORDER_HELD: { tone: 'amber', label: 'On hold' },
  PAYMENT_DISPUTE: { tone: 'red', label: 'Dispute' },
  PAYMENT_FAILED: { tone: 'red', label: 'Payment failed' },
};

/**
 * Exceptions feed (PRD §7C C4) — the things needing the owner's attention: failed/skipped stops, held
 * orders, open disputes, failed payments — server-aggregated + normalized (`GET /owner/exceptions`),
 * newest first. Each row deep-links to the underlying object: a stop exception → its route; everything
 * else → the order detail. Read-only drill (§7C C5).
 */
export function ExceptionsScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const { client } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.exceptions(), [client]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loading && !data) return <Loading label="Loading exceptions…" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const exceptions = data?.exceptions ?? [];
  if (exceptions.length === 0) {
    return <EmptyState testID="exceptions-empty" message="Nothing on fire right now. 🔥🚫" />;
  }

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
      style={styles.container}
      contentContainerStyle={styles.content}
      data={exceptions}
      keyExtractor={(e) => `${e.kind}:${e.id}`}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      renderItem={({ item }) => <ExceptionRow item={item} onPress={() => open(item)} />}
    />
  );
}

function ExceptionRow({ item, onPress }: { item: OwnerException; onPress: () => void }): React.ReactElement {
  const meta = KIND_META[item.kind];
  const tappable = !!item.routeId || !!item.orderId;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={!tappable}
      testID={`exception-${item.id}`}
    >
      <View style={styles.rowTop}>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <Text style={styles.muted}>{timeAgo(item.occurredAt)}</Text>
      </View>
      <Text style={styles.title}>{item.title}</Text>
      {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
      {item.amount ? <Text style={styles.amount}>{money(item.amount, item.currency ?? undefined)}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16 },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eaeef2', gap: 6 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: '#1f2328' },
  detail: { color: '#57606a', fontSize: 13 },
  amount: { color: '#cf222e', fontWeight: '700' },
  muted: { color: '#8c959f', fontSize: 12 },
});
