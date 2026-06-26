import React, { useCallback } from 'react';
import { RefreshControl, View } from 'react-native';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import { useAsync } from '../useAsync';
import { money, percent, shortTime } from '../format';
import { ErrorBox } from '../components/ui';
import { Badge, Button, Icon, Row, Screen, Skeleton, Stat, Text, useTheme, type FeatherName, type Tone } from '../components/kit';
import type { RootStackParamList } from '../navigation';

type Nav = NavigationProp<RootStackParamList>;

/**
 * Today dashboard (PRD §7C C2) — the single glanceable screen: orders today, jobs in flight, GMV
 * approved + cash collected today, on-time %, and the two attention counts (pending approvals,
 * open exceptions) that double as navigation into those feeds. Auto-refreshes on focus + pull-to-
 * refresh. All numbers come server-aggregated from `GET /owner/today` (no client math).
 */
export function DashboardScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const t = useTheme();
  const { client, logout, me } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.today(), [client]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <Screen scroll testID="dashboard" refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={t.color.azure} />}>
      {me?.org?.name ? (
        <Text variant="footnote" color={t.color.textMuted} style={{ marginBottom: 6 }}>
          {me.org.name}
        </Text>
      ) : null}
      <Text variant="title1" style={{ marginBottom: t.spacing.lg }}>
        Today
      </Text>

      {data ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
            <Tile><Stat testID="kpi-orders" label="Orders today" value={String(data.ordersToday)} /></Tile>
            <Tile><Stat label="In flight" value={String(data.activeOrders)} tone="azure" /></Tile>
            <Tile><Stat label="Completed today" value={String(data.completedToday)} tone="success" /></Tile>
            <Tile><Stat label="On-time" value={percent(data.onTimePercent)} /></Tile>
            <Tile><Stat testID="kpi-collected" label="Collected today" value={money(data.collectedToday, data.currency)} tone="success" /></Tile>
            <Tile><Stat label="GMV approved today" value={money(data.revenueToday, data.currency)} /></Tile>
          </View>

          <View style={{ height: t.spacing.lg }} />

          <NavRow
            testID="nav-fleet"
            icon="truck"
            title="Live fleet"
            subtitle="Every truck on the road, in real time"
            onPress={() => navigation.navigate('Fleet')}
          />
          <NavRow
            testID="nav-approvals"
            icon="check-circle"
            title="Approvals"
            subtitle="Quotes awaiting your decision"
            count={data.pendingApprovals}
            onPress={() => navigation.navigate('Approvals')}
          />
          <NavRow
            testID="nav-exceptions"
            icon="alert-triangle"
            title="Exceptions"
            subtitle="Failed stops, holds, disputes, failed payments"
            count={data.openExceptions}
            alert
            onPress={() => navigation.navigate('Exceptions')}
          />

          <Text variant="caption" color={t.color.textFaint} center style={{ marginTop: t.spacing.lg }}>
            Updated {shortTime(data.generatedAt)} · {data.timezone}
          </Text>
        </>
      ) : null}

      <View style={{ height: t.spacing.xl }} />
      <Button testID="settings" label="Settings" onPress={() => navigation.navigate('Settings')} variant="secondary" icon="settings" fullWidth />
      <View style={{ height: t.spacing.md }} />
      <Button testID="signout" label="Sign out" onPress={() => void logout()} variant="ghost" icon="log-out" fullWidth />
    </Screen>
  );
}

/** A half-width grid cell (two KPIs per row). */
function Tile({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={{ width: '47.8%', flexGrow: 1 }}>{children}</View>;
}

function NavRow({
  testID,
  icon,
  title,
  subtitle,
  count,
  alert,
  onPress,
}: {
  testID: string;
  icon: FeatherName;
  title: string;
  subtitle: string;
  count?: number;
  alert?: boolean;
  onPress: () => void;
}): React.ReactElement {
  const t = useTheme();
  const hasCount = count != null && count > 0;
  const dotTone: Tone = alert ? 'danger' : 'azure';
  return (
    <Row testID={testID} onPress={onPress} chevron={!hasCount} style={{ marginBottom: t.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.color.subtle, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={alert ? t.color.dangerInk : t.color.azure} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline">{title}</Text>
          <Text variant="footnote" color={t.color.textMuted} style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        </View>
        {hasCount ? <Badge tone={dotTone}>{String(count)}</Badge> : null}
      </View>
    </Row>
  );
}

function DashboardSkeleton(): React.ReactElement {
  const t = useTheme();
  return (
    <Screen scroll>
      <Skeleton width="35%" height={12} style={{ marginBottom: 10 }} />
      <Skeleton width="40%" height={28} style={{ marginBottom: t.spacing.lg }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={{ width: '47.8%', flexGrow: 1, height: 92, borderRadius: t.radius.card, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.hairline, padding: t.spacing.lg, justifyContent: 'center', gap: 10 }}>
            <Skeleton width="50%" height={24} />
            <Skeleton width="70%" height={10} />
          </View>
        ))}
      </View>
      <View style={{ height: t.spacing.lg }} />
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={{ height: 72, borderRadius: t.radius.card, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.hairline, marginBottom: t.spacing.md, padding: t.spacing.lg, justifyContent: 'center', gap: 8 }}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="75%" height={10} />
        </View>
      ))}
    </Screen>
  );
}
