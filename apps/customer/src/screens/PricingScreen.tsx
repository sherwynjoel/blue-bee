import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@blue-bee/api-client';
import { isCatalogIconKey, type CatalogIconKey, type DrycleanCatalogView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { money } from '../format';
import { useTheme } from '../../theme';
import { Badge, Button, Card, EmptyState, Input, SkeletonCard, StatTile, Text, fireHaptic } from '../../components/ui';

/**
 * Pricing — a read-only, browsable catalogue of the founder's per-garment dry-cleaning prices.
 *
 * Reads the SAME server-resolved catalogue the Book flow uses (`GET /v1/catalog/dryclean`, no cardId ⇒ the
 * full list). Every price on this screen came from the API; where the founder has not set a price the row
 * says "Get a quote" (the honest state), never a fabricated number. The listed per-garment prices are
 * indicative — the binding total is confirmed after intake inspection — and the screen says so.
 *
 * [Royal] This is a TAB now (no native header), so the screen renders its own "Pricing" header + a search
 * field (client-side filter over the already-loaded catalogue — no new endpoint), a trust strip built from
 * REAL catalogue counts, and two informational banners. Neither banner states a discount/offer the server
 * doesn't back — the reference render's "20% off" / "Explore Deals" copy is marketing with no data source,
 * so it's replaced with honest, factual framing (corporate pricing when it applies, otherwise a plain
 * invitation to book) per the app's no-fabrication rule.
 */
type Cat = DrycleanCatalogView['categories'][number];
type Item = Cat['items'][number];
type FeatherName = React.ComponentProps<typeof Feather>['name'];

export function PricingScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client } = useSession();
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();

  const [catalog, setCatalog] = useState<DrycleanCatalogView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string>('all');
  const hasData = useRef(false);

  // [Royal] Local-only UI state — filters the already-loaded catalogue, no new client call.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await client.getDrycleanCatalog();
      hasData.current = true;
      setCatalog(next);
      setError(null);
    } catch (e) {
      if (!hasData.current) setError(e instanceof ApiError ? e.message : 'Could not load pricing.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback((): void => {
    setRefreshing(true);
    void load();
  }, [load]);

  const goBook = useCallback(() => {
    fireHaptic('selection');
    navigation.navigate('Services');
  }, [navigation]);

  const header = useMemo(
    () => (
      <View style={[styles.headerRow, { paddingTop: insets.top + 12, paddingHorizontal: space.xl }]}>
        <View style={{ flex: 1 }}>
          <Text variant="display" weight="700">
            Pricing
          </Text>
          <Text variant="subhead" color="secondary" style={{ marginTop: 4 }}>
            Transparent pricing for every item
          </Text>
        </View>
        <Pressable
          testID="pricing-search-toggle"
          onPress={() => {
            fireHaptic('selection');
            setSearchOpen((v) => {
              if (v) setQuery('');
              return !v;
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? 'Close search' : 'Search items'}
          hitSlop={8}
          style={[
            styles.searchBtn,
            { backgroundColor: colors.surface, borderColor: colors.hairline },
          ]}
        >
          <Feather name={searchOpen ? 'x' : 'search'} size={19} color={colors.azure} />
        </Pressable>
      </View>
    ),
    [insets.top, space.xl, colors, searchOpen],
  );

  const searchBar = searchOpen ? (
    <View style={{ paddingHorizontal: space.xl, marginTop: 14 }}>
      <Input
        testID="pricing-search-input"
        icon="search"
        placeholder="Search items…"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        returnKeyType="search"
      />
    </View>
  ) : null;

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="pricing-loading">
        {header}
        <View style={{ padding: space.xl, gap: 14 }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (error || !catalog) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {header}
        <Card style={styles.stateCard}>
          <Feather name="wifi-off" size={26} color={colors.textTertiary} />
          <Text variant="headline" weight="600" center style={{ marginTop: 10 }}>
            Couldn’t load pricing
          </Text>
          <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
            {error ?? 'Please try again.'}
          </Text>
          <Button testID="pricing-retry" label="Try again" icon="refresh-cw" variant="outline" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
        </Card>
      </View>
    );
  }

  const categories = [...catalog.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((cat) => ({ ...cat, items: [...cat.items].sort((a, b) => a.sortOrder - b.sortOrder) }));
  const totalItems = categories.reduce((n, c) => n + c.items.length, 0);

  if (totalItems === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {header}
        <Card style={{ marginHorizontal: 20, marginTop: 20 }}>
          <EmptyState
            testID="pricing-empty"
            icon="tag"
            title="Prices coming soon"
            body="Per-garment prices aren’t published yet. Start a booking and we’ll send you a quote."
            actionLabel="Book a pickup"
            actionIcon="arrow-right"
            onAction={goBook}
          />
        </Card>
      </View>
    );
  }

  const byCategory = activeCat === 'all' ? categories : categories.filter((c) => c.id === activeCat);
  const q = query.trim().toLowerCase();
  const shown = q
    ? byCategory.map((c) => ({ ...c, items: c.items.filter((it) => it.name.toLowerCase().includes(q)) })).filter((c) => c.items.length > 0)
    : byCategory;

  return (
    <ScrollView
      testID="pricing-scroll"
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={{ paddingBottom: space.huge }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.azure} colors={[colors.azure]} />}
    >
      {header}
      {searchBar}

      {/* Trust strip — real catalogue count for the first tile; the other three are factual claims about
          how pricing works (never a number/discount the server didn't send). */}
      <View style={[styles.trustRow, { paddingHorizontal: space.xl, marginTop: 18 }]}>
        <TrustTile value={`${totalItems}`} label={totalItems === 1 ? 'Item' : 'Items'} icon="shopping-bag" tone="azure" />
        <TrustTile value="Fair" label="Pricing" icon="check-circle" tone="success" />
        <TrustTile value="Quality" label="Guaranteed" icon="shield" tone="honey" />
        <TrustTile value="No Hidden" label="Charges" icon="eye" tone="warning" />
      </View>

      {/* Promo banner — corporate pricing when it applies (real data), otherwise a plain, honest invite to
          book. No invented discount percentage. */}
      <View style={{ paddingHorizontal: space.xl, marginTop: 18 }}>
        {catalog.pricingAccountName ? (
          <PromoBanner
            icon="briefcase"
            title="Corporate pricing applied"
            body={`Your rates from ${catalog.pricingAccountName} are already reflected below.`}
            ctaLabel="Book a pickup"
            onPress={goBook}
          />
        ) : (
          <PromoBanner
            icon="shopping-bag"
            title="Ready to book?"
            body="Every price below is exactly what you’ll pay per item."
            ctaLabel="Book now"
            onPress={goBook}
          />
        )}
      </View>

      {/* Category filter tabs */}
      {categories.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          <Tab label="All Items" icon="list" active={activeCat === 'all'} onPress={() => setActiveCat('all')} />
          {categories.map((c) => (
            <Tab key={c.id} label={c.name} icon={tabIcon(c.icon)} active={activeCat === c.id} onPress={() => setActiveCat(c.id)} />
          ))}
        </ScrollView>
      ) : null}

      {/* Price list, grouped by category */}
      <View style={{ paddingHorizontal: 20, gap: 20, marginTop: categories.length > 1 ? 4 : 16 }}>
        {shown.length === 0 ? (
          <Text testID="pricing-search-empty" variant="subhead" color="secondary" center style={{ marginTop: 12 }}>
            No items match “{query.trim()}”.
          </Text>
        ) : (
          shown.map((cat) => (
            <View key={cat.id} testID={`pricing-category-${cat.id}`}>
              <Text variant="footnote" weight="700" color="secondary" style={styles.catHead}>
                {cat.name.toUpperCase()}
              </Text>
              <View style={{ gap: 8 }}>
                {cat.items.map((it) => (
                  <PriceRow key={it.id} item={it} currency={catalog.currency} />
                ))}
              </View>
            </View>
          ))
        )}

        {/* Reassurance callout — honest restatement of "final total confirmed after inspection", echoing
            the reference render's bottom banner without its unbacked "extra discounts" claim. */}
        <View style={[styles.calloutRow, { backgroundColor: colors.azureTint, borderRadius: 16, padding: 16 }]}>
          <Feather name="shield" size={20} color={colors.azure} style={{ marginRight: 12, marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text variant="subhead" weight="700">
              Clear, upfront pricing
            </Text>
            <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
              No bundling, no hidden charges. Your final total is confirmed once we inspect your items at pickup.
            </Text>
          </View>
        </View>

        <Button testID="pricing-book-cta" label="Book a pickup" icon="arrow-right" onPress={goBook} style={{ marginTop: 4 }} />
      </View>
    </ScrollView>
  );
}

/** Maps a founder-set catalogue icon key to a Feather glyph for the category tab. Unknown/unset → 'tag'. */
const TAB_ICONS: Partial<Record<CatalogIconKey, FeatherName>> = {
  shirts: 'shopping-bag',
  outerwear: 'cloud-snow',
  formalwear: 'award',
  'wash-fold': 'droplet',
  'wash-iron': 'feather',
  'dry-clean': 'wind',
  iron: 'feather',
  delicates: 'feather',
  rug: 'square',
  carpet: 'grid',
  sofa: 'box',
  blinds: 'align-justify',
};
function tabIcon(icon: string | null): FeatherName {
  if (icon && isCatalogIconKey(icon)) return TAB_ICONS[icon] ?? 'tag';
  return 'tag';
}

function Tab({ label, icon, active, onPress }: { label: string; icon: FeatherName; active: boolean; onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        fireHaptic('selection');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.tab, { backgroundColor: active ? colors.azure : colors.subtle, borderColor: active ? colors.azure : 'transparent' }]}
    >
      <Feather name={icon} size={14} color={active ? colors.onAzure : colors.textSecondary} style={{ marginRight: 6 }} />
      <Text variant="subhead" weight="600" style={{ color: active ? colors.onAzure : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One trust-strip tile — tinted icon chip, bold value line, muted caption. Reuses the Royal `StatTile`. */
function TrustTile({ value, label, icon, tone }: { value: string; label: string; icon: FeatherName; tone: 'azure' | 'success' | 'warning' | 'honey' }): React.ReactElement {
  return (
    <Card padding={12} style={styles.trustCard}>
      <StatTile value={value} label={label} icon={icon} iconTone={tone} style={{ alignItems: 'center' }} />
    </Card>
  );
}

/** The solid-azure promo banner (icon chip · headline/body · pill CTA), matching the reference's "Bulk
 *  Discount" band but wired to a real destination and honest copy (see file header note). */
function PromoBanner({
  icon,
  title,
  body,
  ctaLabel,
  onPress,
}: {
  icon: FeatherName;
  title: string;
  body: string;
  ctaLabel: string;
  onPress: () => void;
}): React.ReactElement {
  const { colors, radius, elevation } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.azure, borderRadius: radius.card }, elevation.e2]}>
      <View style={[styles.bannerIcon, { backgroundColor: colors.onAzure }]}>
        <Feather name={icon} size={19} color={colors.azure} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text variant="headline" weight="700" color="onAzure">
          {title}
        </Text>
        <Text variant="footnote" style={{ color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
          {body}
        </Text>
      </View>
      <Pressable
        testID="pricing-banner-cta"
        onPress={() => {
          fireHaptic('selection');
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        style={[styles.bannerCta, { backgroundColor: colors.onAzure, borderRadius: radius.pill }]}
      >
        <Text variant="footnote" weight="700" color="azure">
          {ctaLabel}
        </Text>
        <Feather name="chevron-right" size={14} color={colors.azure} />
      </Pressable>
    </View>
  );
}

/** One garment row: thumbnail · name · price (or the honest "Get a quote" when unset). */
function PriceRow({ item, currency }: { item: Item; currency: string }): React.ReactElement {
  const { colors, radius, elevation } = useTheme();
  const priced = !!item.price;
  return (
    <View
      testID={`pricing-item-${item.id}`}
      style={[styles.row, { backgroundColor: colors.surface, borderRadius: radius.card }, elevation.e1]}
    >
      <View style={[styles.thumb, { backgroundColor: colors.subtle }]}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.thumbImg} resizeMode="cover" />
        ) : (
          <Feather name="shopping-bag" size={18} color={colors.azure} />
        )}
      </View>
      <Text variant="subhead" weight="600" numberOfLines={1} style={{ flex: 1, marginHorizontal: 12 }}>
        {item.name}
      </Text>
      {priced ? (
        <Text variant="subhead" weight="700" color="azure" tabular>
          {money(item.price, currency)}
        </Text>
      ) : (
        <Badge label="Get a quote" tone="neutral" />
      )}
      <Feather name="chevron-right" size={16} color={colors.textTertiary} style={{ marginLeft: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  searchBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  stateCard: { marginHorizontal: 20, marginTop: 20, alignItems: 'center', paddingVertical: 28 },
  trustRow: { flexDirection: 'row', gap: 10 },
  trustCard: { flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  bannerIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bannerCta: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, gap: 4 },
  tabs: { paddingHorizontal: 20, paddingVertical: 14, gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  catHead: { marginBottom: 8, letterSpacing: 0.6 },
  calloutRow: { flexDirection: 'row', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, minHeight: 64 },
  thumb: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
});
