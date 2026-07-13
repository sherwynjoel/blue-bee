import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@blue-bee/api-client';
import type { HomeCtaTarget, HomeView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { money, orderRef, shortDate } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, EmptyState, SkeletonCard, StatusPill, Text, fireHaptic } from '../../components/ui';

/**
 * [Inc-37] Home — the customer's landing tab.
 *
 * Three sections, all LIVE (`GET /v1/home`):
 *   1. **What's new** — the founder's announcement cards, authored in the console. The app hard-codes NO
 *      marketing copy; an edit in the console appears here on the next focus/refresh.
 *   2. **My orders** — a real snapshot of their recent orders.
 *   3. **My account** — identity + their REAL credit balance (the SUM of an append-only ledger).
 *
 * ⚑ HONESTY FIREWALL. The referral reward is rendered from `home.reward` — the founder's FUNDED config —
 * never from a block's free text and never hard-coded. If no reward is funded (`reward.enabled === false`),
 * this screen shows **no reward claim at all**: no "free credits", no amount, no balance row. We only ever
 * promise what the ledger can actually pay.
 */
export function DashboardScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client, me } = useSession();
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();

  const [home, setHome] = useState<HomeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasHome = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await client.getHome();
      hasHome.current = true;
      setHome(next);
      setError(null);
    } catch (e) {
      // A failed REFRESH keeps what's on screen — only a cold failure takes over the screen.
      if (!hasHome.current) setError(e instanceof ApiError ? e.message : 'Could not load your home.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // [Inc-36 pattern] Re-read on tab focus, so a console content/credit change reaches an already-open app.
  const firstFocus = useRef(true);
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void load();
    });
    return unsubscribe;
  }, [navigation, load]);

  const onRefresh = useCallback((): void => {
    setRefreshing(true);
    void load();
  }, [load]);

  /** A block's CTA is a SEMANTIC key, mapped here to a real tab — the console can't route the app anywhere else. */
  const goTo = useCallback(
    (target: HomeCtaTarget): void => {
      fireHaptic('selection');
      if (target === 'refer') navigation.navigate('Refer');
      else if (target === 'orders') navigation.navigate('Orders');
      else navigation.navigate('Services');
    },
    [navigation],
  );

  const firstName = me?.user.name ? me.user.name.split(' ')[0] : null;

  const header = (
    <View style={[styles.headerWrap, { paddingTop: insets.top + 12 }]}>
      <Text variant="display" weight="700">
        {firstName ? `Hi ${firstName}` : 'Welcome'}
      </Text>
      <Text variant="subhead" color="secondary" style={{ marginTop: 4 }}>
        Your laundry & specialty cleaning, in one place.
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="dashboard-loading">
        {header}
        <View style={{ padding: 20, gap: 14 }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (error || !home) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {header}
        <Card style={styles.stateCard}>
          <Feather name="wifi-off" size={26} color={colors.textTertiary} />
          <Text variant="headline" weight="600" center style={{ marginTop: 10 }}>
            Couldn’t load your home
          </Text>
          <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
            {error ?? 'Please try again.'}
          </Text>
          <Button testID="dashboard-retry" label="Try again" icon="refresh-cw" variant="outline" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
        </Card>
      </View>
    );
  }

  const { blocks, credits, reward, recentOrders, orderCount, account } = home;
  const hasReward = reward.enabled && reward.amount != null;

  return (
    <ScrollView
      testID="dashboard-scroll"
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={{ paddingBottom: space.huge }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.azure} colors={[colors.azure]} />}
    >
      {header}

      {/* ─── 1. What's new — the FOUNDER's cards. No blocks authored ⇒ no promo area (never a placeholder). ─── */}
      {blocks.length > 0 ? (
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {blocks.map((b) => (
            <Card key={b.id} testID={`home-block-${b.id}`} style={{ backgroundColor: colors.azureTint, borderColor: colors.azureTint }}>
              <View style={styles.blockHead}>
                <View style={[styles.blockIcon, { backgroundColor: colors.surface }]}>
                  <Feather name={b.ctaTarget === 'refer' ? 'user-plus' : 'bell'} size={18} color={colors.azure} />
                </View>
                <Text variant="headline" weight="700" style={{ flex: 1, marginLeft: 12 }}>
                  {b.title}
                </Text>
              </View>
              <Text variant="footnote" color="secondary" style={{ marginTop: 8, lineHeight: 19 }}>
                {b.body}
              </Text>
              {/* [Inc-37] The reward NUMBER is never taken from the block's free text — it comes from the
                  founder's FUNDED config. With no funded reward this line simply does not exist. */}
              {hasReward && b.ctaTarget === 'refer' ? (
                <Text testID="home-reward-terms" variant="footnote" weight="600" color="azure" style={{ marginTop: 6 }}>
                  {`You earn ${money(reward.amount!, reward.currency)} credit when a friend you invite has their first order delivered.`}
                </Text>
              ) : null}
              {b.ctaLabel && b.ctaTarget ? (
                <Button
                  testID={`home-block-cta-${b.id}`}
                  label={b.ctaLabel}
                  icon="arrow-right"
                  size="sm"
                  fullWidth={false}
                  onPress={() => goTo(b.ctaTarget!)}
                  style={{ marginTop: 12 }}
                />
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}

      {/* ─── 2. My orders ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: space.lg }}>
        <View style={styles.sectionHead}>
          <Text variant="title3" weight="700">
            My orders
          </Text>
          {orderCount > recentOrders.length ? (
            <Pressable testID="home-see-all-orders" onPress={() => goTo('orders')} hitSlop={8}>
              <Text variant="footnote" weight="600" color="azure">
                See all ({orderCount})
              </Text>
            </Pressable>
          ) : null}
        </View>

        {recentOrders.length === 0 ? (
          <Card>
            <EmptyState
              testID="home-no-orders"
              icon="package"
              title="No orders yet"
              body="Pick a service and we’ll collect, clean and deliver it back to you."
              actionLabel="Choose a service"
              actionIcon="plus"
              onAction={() => goTo('services')}
            />
          </Card>
        ) : (
          <Card>
            {recentOrders.map((o, i) => (
              <Pressable
                key={o.id}
                testID={`home-order-${o.id}`}
                onPress={() => {
                  fireHaptic('selection');
                  navigation.navigate('OrderDetail', { orderId: o.id });
                }}
                style={[styles.orderRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="subhead" weight="700" mono>
                    {orderRef(o.id)}
                  </Text>
                  <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                    {shortDate(o.createdAt)}
                  </Text>
                </View>
                <StatusPill status={o.status} />
                {/* An unpriced order shows an em dash — never a fabricated 0.00. */}
                <Text variant="subhead" weight="600" tabular style={{ marginLeft: 10, minWidth: 62, textAlign: 'right' }}>
                  {o.total ? money(o.total, o.currency) : '—'}
                </Text>
              </Pressable>
            ))}
          </Card>
        )}
      </View>

      {/* ─── 3. My account — identity + the REAL credit balance ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: space.lg }}>
        <Text variant="title3" weight="700" style={{ marginBottom: 10 }}>
          My account
        </Text>
        <Card>
          <Pressable
            testID="home-account-row"
            onPress={() => {
              fireHaptic('selection');
              navigation.navigate('Settings');
            }}
            style={styles.acctRow}
          >
            <View style={[styles.blockIcon, { backgroundColor: colors.azureTint }]}>
              <Feather name="user" size={18} color={colors.azure} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text variant="subhead" weight="600">
                {account.name || '—'}
              </Text>
              <Text variant="caption" color="tertiary" style={{ marginTop: 1 }}>
                {account.email ?? account.phone ?? 'Manage your profile'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textTertiary} />
          </Pressable>

          {/*
            [Inc-37] The credit row exists ONLY when the founder has funded a reward OR the customer actually
            holds a balance. With no reward and no credit there is nothing true to say, so we say nothing —
            rather than showing a hard-coded "0 credits" that would be a stub and a hollow promise.
          */}
          {hasReward || credits.balance !== '0.00' ? (
            <View style={[styles.creditRow, { borderTopColor: colors.hairline }]}>
              <View style={[styles.blockIcon, { backgroundColor: colors.successTint }]}>
                <Feather name="gift" size={18} color={colors.success} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="caption" color="tertiary">
                  CREDIT BALANCE
                </Text>
                <Text testID="home-credit-balance" variant="title3" weight="700" color="success" tabular style={{ marginTop: 1 }}>
                  {money(credits.balance, credits.currency)}
                </Text>
                <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                  {credits.balance === '0.00'
                    ? 'Applied automatically to your next order.'
                    : 'Applied automatically at checkout on your next order.'}
                </Text>
              </View>
            </View>
          ) : null}

          {account.referralCode ? (
            <Pressable
              testID="home-invite-row"
              onPress={() => goTo('refer')}
              style={[styles.creditRow, { borderTopColor: colors.hairline }]}
            >
              <View style={[styles.blockIcon, { backgroundColor: colors.honeyTint }]}>
                <Feather name="user-plus" size={18} color={colors.honey} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="subhead" weight="600">
                  Invite friends
                </Text>
                <Text variant="caption" color="tertiary" style={{ marginTop: 1 }} mono>
                  {account.referralCode}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  stateCard: { marginHorizontal: 20, alignItems: 'center', paddingVertical: 28 },
  blockHead: { flexDirection: 'row', alignItems: 'center' },
  blockIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  orderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  acctRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  creditRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
