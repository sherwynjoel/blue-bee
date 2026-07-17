import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { ApiError } from '@blue-bee/api-client';
import type { DrycleanCatalogView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { money } from '../format';
import { useTheme } from '../../theme';
import { Badge, Button, Card, EmptyState, Hero, SkeletonCard, Text, fireHaptic } from '../../components/ui';

/**
 * Pricing — a read-only, browsable catalogue of the founder's per-garment dry-cleaning prices.
 *
 * Reads the SAME server-resolved catalogue the Book flow uses (`GET /v1/catalog/dryclean`, no cardId ⇒ the
 * full list). Every price on this screen came from the API; where the founder has not set a price the row
 * says "Get a quote" (the honest state), never a fabricated number. The listed per-garment prices are
 * indicative — the binding total is confirmed after intake inspection — and the screen says so.
 */
type Cat = DrycleanCatalogView['categories'][number];
type Item = Cat['items'][number];

export function PricingScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client } = useSession();
  const { colors, space } = useTheme();

  const [catalog, setCatalog] = useState<DrycleanCatalogView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string>('all');
  const hasData = useRef(false);

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

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="pricing-loading">
        <View style={{ padding: 20, gap: 14 }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (error || !catalog) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
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
  const shown = activeCat === 'all' ? categories : categories.filter((c) => c.id === activeCat);

  if (totalItems === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <Card style={{ margin: 20 }}>
          <EmptyState
            testID="pricing-empty"
            icon="tag"
            title="Prices coming soon"
            body="Per-garment prices aren’t published yet. Start a booking and we’ll send you a quote."
            actionLabel="Book a pickup"
            actionIcon="arrow-right"
            onAction={() => {
              fireHaptic('selection');
              navigation.navigate('Services');
            }}
          />
        </Card>
      </View>
    );
  }

  return (
    <ScrollView
      testID="pricing-scroll"
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={{ paddingBottom: space.huge }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.azure} colors={[colors.azure]} />}
    >
      {/* Hero — factual framing only (real item count, real corporate account when present). */}
      <View style={{ padding: 20 }}>
        <Hero>
          <Text variant="title2" weight="700">
            Transparent pricing
          </Text>
          <Text variant="subhead" color="secondary" style={{ marginTop: 6 }}>
            Per-garment dry cleaning. Your final total is confirmed after we inspect your items.
          </Text>
          <View style={styles.chips}>
            <Badge label={`${totalItems} ${totalItems === 1 ? 'garment' : 'garments'}`} tone="azure" />
            {catalog.pricingAccountName ? <Badge label={`Corporate · ${catalog.pricingAccountName}`} tone="honey" /> : null}
          </View>
        </Hero>
      </View>

      {/* Category filter tabs */}
      {categories.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          <Tab label="All" active={activeCat === 'all'} onPress={() => setActiveCat('all')} />
          {categories.map((c) => (
            <Tab key={c.id} label={c.name} active={activeCat === c.id} onPress={() => setActiveCat(c.id)} />
          ))}
        </ScrollView>
      ) : null}

      {/* Price list, grouped by category */}
      <View style={{ paddingHorizontal: 20, gap: 18, marginTop: 6 }}>
        {shown.map((cat) => (
          <View key={cat.id} testID={`pricing-category-${cat.id}`}>
            <Text variant="footnote" weight="700" color="secondary" style={styles.catHead}>
              {cat.name.toUpperCase()}
            </Text>
            <Card padding={0}>
              {cat.items.map((it, idx) => (
                <PriceRow key={it.id} item={it} currency={catalog.currency} last={idx === cat.items.length - 1} />
              ))}
            </Card>
          </View>
        ))}

        <Button
          testID="pricing-book-cta"
          label="Book a pickup"
          icon="arrow-right"
          onPress={() => {
            fireHaptic('selection');
            navigation.navigate('Services');
          }}
          style={{ marginTop: 4 }}
        />
      </View>
    </ScrollView>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        fireHaptic('selection');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.tab, { backgroundColor: active ? colors.azure : colors.surface, borderColor: active ? colors.azure : colors.hairline }]}
    >
      <Text variant="subhead" weight="600" style={{ color: active ? colors.onAzure : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One garment row: thumbnail · name · price (or the honest "Get a quote" when unset). */
function PriceRow({ item, currency, last }: { item: Item; currency: string; last: boolean }): React.ReactElement {
  const { colors } = useTheme();
  const priced = !!item.price;
  return (
    <View
      testID={`pricing-item-${item.id}`}
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline }]}
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
        <Text variant="footnote" weight="600" color="tertiary">
          Get a quote
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stateCard: { marginHorizontal: 20, marginTop: 20, alignItems: 'center', paddingVertical: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  tabs: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  catHead: { marginBottom: 8, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 },
  thumb: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
});
