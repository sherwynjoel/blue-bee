import React, { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import type { OwnerApproval } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { useAsync } from '../useAsync';
import { money, orderRef, shortDate } from '../format';
import { Badge, EmptyState, ErrorBox, Loading } from '../components/ui';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;

/**
 * Approvals (PRD §7C C3) — the quotes awaiting the owner's decision (the as-built supports quote
 * approvals; there is no threshold/claims/credits approval object). Tapping a row opens the order
 * detail, where the owner approves/declines via the proven `quote:approve|:decline` (server-
 * authoritative; a 409 re-syncs). Read-only list here; the decision happens on the order.
 */
export function ApprovalsScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const { client } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.approvals(), [client]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loading && !data) return <Loading label="Loading approvals…" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const approvals = data?.approvals ?? [];
  if (approvals.length === 0) {
    return <EmptyState testID="approvals-empty" message="No quotes are waiting for your approval. 🎉" />;
  }

  return (
    <FlatList
      testID="approvals-list"
      style={styles.container}
      contentContainerStyle={styles.content}
      data={approvals}
      keyExtractor={(a) => a.orderId}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      renderItem={({ item }) => <ApprovalRow item={item} onPress={() => navigation.navigate('OrderDetail', { orderId: item.orderId })} />}
    />
  );
}

function ApprovalRow({ item, onPress }: { item: OwnerApproval; onPress: () => void }): React.ReactElement {
  const expired = item.expiresAt != null && new Date(item.expiresAt).getTime() < Date.now();
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} testID={`approval-${item.orderId}`}>
      <View style={styles.rowTop}>
        <Text style={styles.account}>{item.accountName}</Text>
        <Text style={styles.total}>{money(item.total, item.currency)}</Text>
      </View>
      <Text style={styles.sub}>
        {orderRef(item.orderId)} · {item.itemCount} item{item.itemCount === 1 ? '' : 's'}
        {item.siteName ? ` · ${item.siteName}` : ''}
      </Text>
      <View style={styles.rowBottom}>
        <Text style={styles.muted}>Quoted {shortDate(item.quotedAt)}</Text>
        {item.expiresAt ? (
          <Badge tone={expired ? 'red' : 'amber'}>{expired ? 'Expired' : `Valid to ${shortDate(item.expiresAt)}`}</Badge>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16 },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eaeef2', gap: 6 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  account: { fontSize: 16, fontWeight: '700', color: '#1f2328', flex: 1 },
  total: { fontSize: 16, fontWeight: '800', color: '#1a7f37' },
  sub: { color: '#57606a', fontSize: 13 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  muted: { color: '#8c959f', fontSize: 12 },
});
