import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@blue-bee/api-client';
import type { HomeCtaTarget, HomeView, OrderStatus } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { money, orderRef, shortDate } from '../format';
import { customerStatus, type CustomerTone } from '../orders/timeline';
import { useTheme } from '../../theme';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Hero,
  IconBadge,
  SectionHeader,
  Sheet,
  SkeletonCard,
  Text,
  TrustStrip,
  fireHaptic,
  type IconTone,
} from '../../components/ui';

/**
 * [Inc-37] Home — the customer's landing tab. [Royal restyle] Plain greeting + avatar, a gradient
 * "earn free credits" Hero promo, a single quick-actions strip, recent orders (customer-facing status),
 * my account and a static trust strip — matching the reference render. Every section is still LIVE
 * (`GET /v1/home`) and the data/refetch wiring below is unchanged from Inc-37.
 *
 * ⚑ HONESTY FIREWALL. The referral reward is rendered from `home.reward` — the founder's FUNDED config —
 * never hard-coded. With no funded reward and no credit, no reward/credit row appears at all. Quick
 * actions are pure navigation shortcuts (no invented data); "Customize" has no backend yet, so it opens
 * an honest "coming soon" sheet instead of pretending to work.
 */
export function DashboardScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client, me } = useSession();
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [home, setHome] = useState<HomeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
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
  const avatarInitial = (me?.user.name?.[0] ?? '?').toUpperCase();

  const header = (
    <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 12 }}>
      <View style={styles.headerRow} testID="dashboard-hero">
        <View style={{ flex: 1 }}>
          <Text variant="title1" weight="700">
            {firstName ? `Hi ${firstName} 👋` : 'Welcome 👋'}
          </Text>
          <Text variant="subhead" color="secondary" style={{ marginTop: 4 }}>
            Fresh, clean, delivered to you.
          </Text>
        </View>
        <Pressable
          testID="home-avatar"
          onPress={() => {
            fireHaptic('selection');
            navigation.navigate('Settings');
          }}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          hitSlop={8}
        >
          <View style={[styles.avatar, { backgroundColor: colors.azureTint }]}>
            <Text variant="headline" weight="700" color="azure">
              {avatarInitial}
            </Text>
          </View>
        </Pressable>
      </View>
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

      {/* ─── What's new — the FOUNDER's cards, in a gradient Hero band. No blocks authored ⇒ nothing here. ─── */}
      {blocks.length > 0 ? (
        <View style={{ paddingHorizontal: 20, gap: 12, marginTop: space.lg }}>
          {blocks.map((b) => {
            const isReferCard = b.ctaTarget === 'refer';
            return (
              <Hero key={b.id} testID={`home-block-${b.id}`}>
                <View style={styles.blockHead}>
                  <IconBadge icon={isReferCard ? 'gift' : 'bell'} tone="azure" size={56} circle style={{ marginRight: 14 }} />
                  <View style={{ flex: 1 }}>
                    <Text variant="headline" weight="700">
                      {b.title}
                    </Text>
                    <Text variant="footnote" color="secondary" style={{ marginTop: 6, lineHeight: 19 }}>
                      {b.body}
                    </Text>
                    {/* The reward NUMBER is never taken from the block's free text — it comes from the founder's
                        FUNDED config. With no funded reward this line simply does not exist. */}
                    {hasReward && isReferCard ? (
                      <Text testID="home-reward-terms" variant="footnote" weight="600" color="azure" style={{ marginTop: 6 }}>
                        {`You earn ${money(reward.amount!, reward.currency)} credit when a friend you invite has their first order delivered.`}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {b.ctaLabel && b.ctaTarget ? (
                  <Button
                    testID={`home-block-cta-${b.id}`}
                    label={b.ctaLabel}
                    icon="arrow-right"
                    size="md"
                    fullWidth={false}
                    onPress={() => goTo(b.ctaTarget!)}
                    style={{ marginTop: 16 }}
                  />
                ) : null}
              </Hero>
            );
          })}
        </View>
      ) : null}

      {/* ─── Quick actions — pure navigation shortcuts (no invented data). ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: space.lg }}>
        <View style={styles.sectionHead}>
          <Text variant="title3" weight="700">
            Quick actions
          </Text>
          <Pressable
            testID="home-quick-actions-customize"
            onPress={() => {
              fireHaptic('selection');
              setCustomizeOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Customize quick actions"
            style={[styles.customizePill, { backgroundColor: colors.azureTint, borderRadius: radius.pill }]}
          >
            <Feather name="sliders" size={13} color={colors.azure} />
            <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6 }}>
              Customize
            </Text>
          </Pressable>
        </View>
        <Card>
          <View style={styles.qaRow}>
            <QuickAction testID="qa-new-order" icon="shopping-bag" tone="azure" label="New Order" caption="Place a new order" onPress={() => navigation.navigate('Services')} />
            <QuickAction testID="qa-pricing" icon="tag" tone="success" label="Price Estimate" caption="Get estimate" onPress={() => navigation.navigate('Pricing')} />
            <QuickAction testID="qa-orders" icon="map-pin" tone="warning" label="Track Order" caption="Live tracking" onPress={() => navigation.navigate('Orders')} />
            <QuickAction testID="qa-refer" icon="gift" tone="honey" label="Invite Friends" caption="Share your code" onPress={() => navigation.navigate('Refer')} />
          </View>
        </Card>
      </View>

      {/* ─── My orders ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: space.lg }}>
        <View style={styles.sectionHead}>
          <Text variant="title3" weight="700">
            My orders
          </Text>
          {orderCount > recentOrders.length ? (
            <Pressable testID="home-see-all-orders" onPress={() => goTo('orders')} hitSlop={8} style={styles.seeAll} accessibilityRole="button">
              <Text variant="footnote" weight="600" color="azure">
                See all ({orderCount})
              </Text>
              <Feather name="chevron-right" size={16} color={colors.azure} />
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
          <Card padding={0}>
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
                <OrderRowIcon status={o.status} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="subhead" weight="700" mono>
                    {orderRef(o.id)}
                  </Text>
                  <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                    {shortDate(o.createdAt)}
                  </Text>
                </View>
                <OrderStatusPill status={o.status} />
                {/* An unpriced order shows an em dash — never a fabricated 0.00. */}
                <Text variant="subhead" weight="600" tabular style={{ marginLeft: 10, minWidth: 62, textAlign: 'right' }}>
                  {o.total ? money(o.total, o.currency) : '—'}
                </Text>
              </Pressable>
            ))}
          </Card>
        )}
      </View>

      {/* ─── My account — identity + the REAL credit balance ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: space.lg }}>
        <SectionHeader title="My account" style={{ marginBottom: 10 }} />
        <Card padding={0}>
          <Pressable
            testID="home-account-row"
            onPress={() => {
              fireHaptic('selection');
              navigation.navigate('Settings');
            }}
            style={styles.acctRow}
          >
            <IconBadge icon="user" tone="neutral" size={44} circle />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text variant="subhead" weight="700">
                {account.name || '—'}
              </Text>
              <Text variant="caption" color="tertiary" style={{ marginTop: 1 }} numberOfLines={1}>
                {account.email ?? account.phone ?? 'Manage your profile'}
              </Text>
            </View>
            <View style={[styles.editPill, { backgroundColor: colors.azureTint, borderRadius: radius.pill }]}>
              <Feather name="edit-2" size={12} color={colors.azure} />
              <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6, marginRight: 2 }}>
                Edit profile
              </Text>
              <Feather name="chevron-right" size={14} color={colors.azure} />
            </View>
          </Pressable>

          {/*
            The credit / invite split exists only when there is something TRUE to show — a funded reward
            or a real balance, and a real invite code. No hard-coded "0 credits" hollow promise.
          */}
          {hasReward || credits.balance !== '0.00' || account.referralCode ? (
            <View style={[styles.acctSplit, { borderTopColor: colors.hairline }]}>
              {hasReward || credits.balance !== '0.00' ? (
                <View style={styles.acctCol}>
                  <IconBadge icon="gift" tone="success" size={36} />
                  <Text variant="caption" color="tertiary" style={{ marginTop: 8 }}>
                    CREDIT BALANCE
                  </Text>
                  <Text testID="home-credit-balance" variant="title3" weight="700" color="success" tabular style={{ marginTop: 1 }}>
                    {money(credits.balance, credits.currency)}
                  </Text>
                  <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                    Applied automatically to your next order.
                  </Text>
                </View>
              ) : null}

              {account.referralCode ? (
                <Pressable testID="home-invite-row" onPress={() => goTo('refer')} style={styles.acctCol}>
                  <IconBadge icon="user-plus" tone="honey" size={36} />
                  <Text variant="caption" color="tertiary" style={{ marginTop: 8 }}>
                    INVITE FRIENDS
                  </Text>
                  <Text variant="subhead" weight="700" mono style={{ marginTop: 1 }}>
                    {account.referralCode}
                  </Text>
                  <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                    Share your code
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Card>
      </View>

      {/* ─── Trust strip — static value-prop chrome (no numbers, no per-user claims). ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: space.lg }}>
        <TrustStrip
          items={[
            { icon: 'truck', tone: 'azure', label: 'Free Pickup', caption: 'On all orders' },
            { icon: 'check-circle', tone: 'success', label: 'Quality Clean', caption: 'Always guaranteed' },
            { icon: 'clock', tone: 'honey', label: 'On-time Delivery', caption: 'Right to your door' },
            { icon: 'shield', tone: 'neutral', label: 'Secure & Safe', caption: 'Your items, safe with us' },
          ]}
        />
      </View>

      <Sheet visible={customizeOpen} onClose={() => setCustomizeOpen(false)} title="Customize quick actions" testID="home-customize-sheet">
        <Text variant="subhead" color="secondary" style={{ marginBottom: 16 }}>
          Choosing your own quick actions is coming soon. For now these four shortcuts are fixed.
        </Text>
        <Button label="Got it" variant="outline" onPress={() => setCustomizeOpen(false)} />
      </Sheet>
    </ScrollView>
  );
}

/** A quick-action column — icon chip, bold label, caption. Navigation only, no data. */
function QuickAction({
  icon,
  tone,
  label,
  caption,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  tone: IconTone;
  label: string;
  caption: string;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        fireHaptic('selection');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${caption}`}
      style={styles.qaCol}
    >
      <IconBadge icon={icon} tone={tone} size={38} />
      <Text variant="subhead" weight="700" style={{ marginTop: 10 }} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="caption" color="tertiary" style={{ marginTop: 2 }} numberOfLines={1}>
        {caption}
      </Text>
    </Pressable>
  );
}

/** Maps the customer-facing status tone (from `customerStatus`) onto the Badge/IconBadge palette. */
const TONE_MAP: Record<CustomerTone, IconTone> = {
  active: 'azure',
  transit: 'honey',
  delivered: 'success',
  exception: 'danger',
  hold: 'warning',
};

/** The order row's leading icon chip — colour + glyph follow the customer-facing stage, never the raw
 *  internal status (the customer must never see "quoted"/"in cleaning" plant-only states). */
function OrderRowIcon({ status }: { status: OrderStatus }): React.ReactElement {
  const cs = customerStatus(status);
  const icon: React.ComponentProps<typeof Feather>['name'] = cs.tone === 'transit' ? 'truck' : cs.tone === 'delivered' ? 'check-circle' : 'shopping-bag';
  return <IconBadge icon={icon} tone={TONE_MAP[cs.tone]} size={40} />;
}

/** The order row's status pill — the customer-facing label + tone (never the raw ops status). */
function OrderStatusPill({ status }: { status: OrderStatus }): React.ReactElement {
  const cs = customerStatus(status);
  return <Badge label={cs.label} tone={TONE_MAP[cs.tone]} dot={cs.tone === 'transit'} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stateCard: { marginHorizontal: 20, marginTop: 8, alignItems: 'center', paddingVertical: 28 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  blockHead: { flexDirection: 'row', alignItems: 'flex-start' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  seeAll: { flexDirection: 'row', alignItems: 'center' },
  customizePill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 },
  qaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  qaCol: { flex: 1, alignItems: 'flex-start', paddingRight: 6 },
  orderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  acctRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  editPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7 },
  acctSplit: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  acctCol: { flex: 1 },
});
