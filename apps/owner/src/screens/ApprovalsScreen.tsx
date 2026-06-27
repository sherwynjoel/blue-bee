import React, { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import type { OwnerApproval } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { useAsync } from '../useAsync';
import { money, orderRef, shortDate } from '../format';
import { EmptyState, ErrorBox, Loading } from '../components/ui';
import { Badge, Row, Text, useTheme } from '../components/kit';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;

/**
 * Approvals (PRD §7C C3) — the quotes awaiting the owner's decision (the as-built supports quote
 * approvals; there is no threshold/claims/credits approval object). Tapping a row opens the order
 * detail, where the owner approves/declines via the proven `quote:approve|:decline` (server-
 * authoritative; a 409 re-syncs). Read-only list here; the decision happens on the order.
 */
export function ApprovalsScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const t = useTheme();
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
    return <EmptyState testID="approvals-empty" message="No quotes are waiting for your approval." />;
  }

  return (
    <FlatList
      testID="approvals-list"
      style={{ flex: 1, backgroundColor: t.color.canvas }}
      contentContainerStyle={{ padding: t.spacing.lg }}
      data={approvals}
      keyExtractor={(a) => a.orderId}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={t.color.azure} />}
      renderItem={({ item }) => <ApprovalRow item={item} onPress={() => navigation.navigate('OrderDetail', { orderId: item.orderId })} />}
    />
  );
}

function ApprovalRow({ item, onPress }: { item: OwnerApproval; onPress: () => void }): React.ReactElement {
  const t = useTheme();
  const expired = item.expiresAt != null && new Date(item.expiresAt).getTime() < Date.now();
  return (
    <Row testID={`approval-${item.orderId}`} onPress={onPress} style={{ marginBottom: t.spacing.md }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {item.accountName}
          </Text>
          <Text variant="headline" color={t.color.successInk} mono tabular>
            {money(item.total, item.currency)}
          </Text>
        </View>
        <Text variant="footnote" color={t.color.textMuted}>
          <Text variant="footnote" color={t.color.textMuted} mono>
            {orderRef(item.orderId)}
          </Text>
          {` · ${item.itemCount} item${item.itemCount === 1 ? '' : 's'}`}
          {item.siteName ? ` · ${item.siteName}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <Text variant="caption" color={t.color.textFaint}>
            Quoted {shortDate(item.quotedAt)}
          </Text>
          {item.expiresAt ? (
            <Badge tone={expired ? 'danger' : 'warning'} icon={expired ? 'alert-circle' : 'clock'}>
              {expired ? 'Expired' : `Valid to ${shortDate(item.expiresAt)}`}
            </Badge>
          ) : null}
        </View>
      </View>
    </Row>
  );
}
