import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import { useAsync } from '../useAsync';
import { money, percent, shortTime } from '../format';
import { Card, ErrorBox, Loading } from '../components/ui';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;

/**
 * Today dashboard (PRD §7C C2) — the single glanceable screen: orders today, jobs in flight, GMV
 * approved + cash collected today, on-time %, and the two attention counts (pending approvals,
 * open exceptions) that double as navigation into those feeds. Auto-refreshes on focus + pull-to-
 * refresh. All numbers come server-aggregated from `GET /owner/today` (no client math).
 */
export function DashboardScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const { client, logout, me } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.today(), [client]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loading && !data) return <Loading label="Loading today…" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      testID="dashboard"
    >
      {me?.org?.name ? <Text style={styles.org}>{me.org.name}</Text> : null}
      {data ? (
        <>
          <View style={styles.grid}>
            <Kpi label="Orders today" value={String(data.ordersToday)} testID="kpi-orders" />
            <Kpi label="In flight" value={String(data.activeOrders)} />
            <Kpi label="Completed today" value={String(data.completedToday)} />
            <Kpi label="On-time" value={percent(data.onTimePercent)} />
            <Kpi label="Collected today" value={money(data.collectedToday, data.currency)} testID="kpi-collected" />
            <Kpi label="GMV approved today" value={money(data.revenueToday, data.currency)} />
          </View>

          <TouchableOpacity testID="nav-fleet" onPress={() => navigation.navigate('Fleet')}>
            <Card>
              <NavRow icon="🚚" title="Live fleet" subtitle="Every truck on the road, in real time" />
            </Card>
          </TouchableOpacity>

          <TouchableOpacity testID="nav-approvals" onPress={() => navigation.navigate('Approvals')}>
            <Card>
              <NavRow icon="✅" title="Approvals" subtitle="Quotes awaiting your decision" count={data.pendingApprovals} />
            </Card>
          </TouchableOpacity>

          <TouchableOpacity testID="nav-exceptions" onPress={() => navigation.navigate('Exceptions')}>
            <Card>
              <NavRow
                icon="⚠️"
                title="Exceptions"
                subtitle="Failed stops, holds, disputes, failed payments"
                count={data.openExceptions}
                alert
              />
            </Card>
          </TouchableOpacity>

          <Text style={styles.stamp}>Updated {shortTime(data.generatedAt)} · {data.timezone}</Text>
        </>
      ) : null}

      <TouchableOpacity style={styles.signout} onPress={() => void logout()} testID="signout">
        <Text style={styles.signoutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Kpi({ label, value, testID }: { label: string; value: string; testID?: string }): React.ReactElement {
  return (
    <View style={styles.kpi} testID={testID}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function NavRow({
  icon,
  title,
  subtitle,
  count,
  alert,
}: {
  icon: string;
  title: string;
  subtitle: string;
  count?: number;
  alert?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.navRow}>
      <Text style={styles.navIcon}>{icon}</Text>
      <View style={styles.navText}>
        <Text style={styles.navTitle}>{title}</Text>
        <Text style={styles.navSub}>{subtitle}</Text>
      </View>
      {count != null && count > 0 ? (
        <View style={[styles.countPill, alert ? styles.countAlert : styles.countNeutral]}>
          <Text style={[styles.countText, alert ? styles.countTextAlert : styles.countTextNeutral]}>{count}</Text>
        </View>
      ) : (
        <Text style={styles.chev}>›</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16, paddingBottom: 40 },
  org: { fontSize: 14, color: '#57606a', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  kpi: { width: '48%', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eaeef2' },
  kpiValue: { fontSize: 24, fontWeight: '800', color: '#1f2328' },
  kpiLabel: { fontSize: 12, color: '#57606a', marginTop: 4 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navIcon: { fontSize: 24 },
  navText: { flex: 1 },
  navTitle: { fontSize: 16, fontWeight: '700', color: '#1f2328' },
  navSub: { fontSize: 12, color: '#57606a', marginTop: 2 },
  countPill: { minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  countNeutral: { backgroundColor: '#ddf4ff' },
  countAlert: { backgroundColor: '#ffebe9' },
  countText: { fontWeight: '800', fontSize: 14 },
  countTextNeutral: { color: '#0969da' },
  countTextAlert: { color: '#cf222e' },
  chev: { fontSize: 24, color: '#8c959f' },
  stamp: { color: '#8c959f', fontSize: 12, textAlign: 'center', marginTop: 12 },
  signout: { marginTop: 24, alignItems: 'center' },
  signoutText: { color: '#57606a', fontSize: 15 },
});
