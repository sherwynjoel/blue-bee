import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@blue-bee/api-client';
import { ItemKind, PricingModel, PricingUnit, isCatalogIconKey, type CatalogIconKey, type HomeServiceMenuView, type HomeServiceCardView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { money } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, EmptyState, IconBadge, SkeletonCard, Text, fireHaptic } from '../../components/ui';

/**
 * Home — the service grid (PRD §7A). A 2-up grid of the org's service categories, driven ENTIRELY by the
 * live catalog (`getServiceMenu` → `GET /v1/catalog/home`): each card is a category's icon → title → a plain
 * one-line description → a "from" price. Nothing here is hard-coded — `description`/`icon`/`unit`/`priceFrom`
 * and the backing `serviceId` all come from the server (founder-editable in the `/catalog` console). The card
 * degrades gracefully when a field is unset (missing copy omitted; unknown icon falls back; no price → an
 * honest "Get a quote").
 *
 * [Inc-36] The card's `serviceId` is what makes a tap open the FOCUSED single-measure checkout, so the grid
 * re-reads the catalog on focus + pull-to-refresh (see `load`): a stale copy would send `serviceId: undefined`
 * and dead-end the customer at "Choose a service".
 */
export function HomeScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client, me } = useSession();
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();

  const [catalog, setCatalog] = useState<HomeServiceMenuView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether we've ever held a catalog — so a failed RE-fetch keeps the grid instead of blanking it. */
  const hasCatalog = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await client.getServiceMenu();
      hasCatalog.current = true;
      setCatalog(next);
      setError(null);
    } catch (e) {
      // A refresh that fails must NOT throw away a grid the customer is already looking at — only show the
      // full error state when we have nothing to fall back to.
      if (!hasCatalog.current) setError(e instanceof ApiError ? e.message : 'Could not load our services.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * [Inc-36] Re-read the catalog whenever the Service tab regains focus.
   *
   * Without this the grid was fetched ONCE per app launch and never again — so a founder changing a rate,
   * description or unit in the `/catalog` console was invisible to every customer who already had the app
   * open (they'd keep tapping cards built from a stale `serviceId`). Tabs stay mounted in React Navigation,
   * so switching away and back does not remount this screen; the explicit 'focus' listener is what makes the
   * console → app round-trip actually reach a running app.
   *
   * `addListener` (not `useFocusEffect`) for the same reason BookScreen uses it: it works without a
   * NavigationContainer, so this stays unit-testable. The first focus fires right after mount, which the
   * effect above already covered — skip it rather than fetch twice on launch.
   */
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

  const firstName = me?.user.name ? me.user.name.split(' ')[0] : null;
  // [Inc-24] Render in the order the founder arranged in the console. The server already sorts by sortOrder;
  // sorting here too makes the grid's order a pure function of sortOrder rather than of response order.
  const categories = [...(catalog?.cards ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const currency = catalog?.currency ?? 'CAD';

  const header = (
    <View style={[styles.headerWrap, { paddingTop: insets.top + 12 }]}>
      <Text variant="display" weight="700">
        Our services
      </Text>
      <Text variant="subhead" color="secondary" style={{ marginTop: 4 }}>
        {firstName ? `Hi ${firstName} — pick a service to get started.` : 'Pick a service to get started.'}
      </Text>
      {/* [Inc-36] The Inc-33 "Book a pickup" button is GONE. Every bar below carries a backing service, so a
          tap always opens the focused checkout. [Royal] A quiet link into the read-only per-garment price list. */}
      <Pressable
        testID="home-view-pricing"
        onPress={() => {
          fireHaptic('selection');
          navigation.navigate('Pricing');
        }}
        accessibilityRole="button"
        accessibilityLabel="View full price list"
        style={styles.pricingLink}
        hitSlop={8}
      >
        <Feather name="tag" size={15} color={colors.azure} />
        <Text variant="subhead" weight="600" style={{ color: colors.azure, marginLeft: 6 }}>
          View full price list
        </Text>
        <Feather name="chevron-right" size={16} color={colors.azure} />
      </Pressable>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="home-loading">
        {header}
        <View style={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {header}
        <Card style={styles.stateCard}>
          <Feather name="wifi-off" size={26} color={colors.textTertiary} />
          <Text variant="headline" weight="600" center style={{ marginTop: 10 }}>
            Couldn’t load our services
          </Text>
          <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
            {error}
          </Text>
          <Button testID="home-retry" label="Try again" icon="refresh-cw" variant="outline" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
        </Card>
      </View>
    );
  }

  return (
    <ScrollView
      testID="home-scroll"
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={{ paddingBottom: space.huge }}
      showsVerticalScrollIndicator={false}
      // [Inc-36] Pull-to-refresh — the customer's own way to pick up a fresh catalog (alongside the
      // focus re-fetch above), so a founder's console edit never needs an app restart to appear.
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.azure} colors={[colors.azure]} />
      }
    >
      {header}
      {categories.length === 0 ? (
        <View style={{ paddingHorizontal: space.xl }}>
          {/* [Inc-36] No CTA here any more: with no services there is nothing to book, and the old CTA led
              into the general composer. Honest empty state — check back. */}
          <EmptyState icon="tag" title="No services yet" body="Our catalog is being set up. Check back soon." />
        </View>
      ) : (
        <View style={styles.list}>
          {categories.map((cat) => (
            <ServiceBar
              key={cat.id}
              category={cat}
              currency={currency}
              // [Inc-23] Carry the card's backing service into Book so the order references the right
              // service → pricingModel. A card with no backing service yet (rate unset) opens the general
              // composer (undefined param).
              // [Inc-38] Carry the card id + its garment count too: a card with garments nested under it is
              // priced PER GARMENT, so Book drills into the picker instead of asking for one measure. Which
              // cards those are is the founder's catalog talking — never a name/icon check in the app.
              onPress={() =>
                navigation.navigate(
                  'Book',
                  cat.serviceId
                    ? {
                        serviceId: cat.serviceId,
                        serviceName: cat.name,
                        unit: cat.unit,
                        kind: kindForCard(cat),
                        cardId: cat.id,
                        garmentCount: cat.garmentCount,
                      }
                    : undefined,
                )
              }
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** A semantic icon key → a Feather icon + a theme tint. Pure presentation; the founder sets the key in the
 *  console. Unknown keys fall back to a neutral tile so a new service never renders broken. */
type Tint = 'azure' | 'honey' | 'success';
/**
 * [Inc-24] Keyed by `CatalogIconKey` — the canonical icon keys in packages/shared, which the console's icon
 * PICKER offers. Typing it as a full `Record<CatalogIconKey, …>` means adding a key in shared fails this
 * app's typecheck until it is mapped here, so the console can never offer an icon the app cannot render.
 */
const CATEGORY_ICONS: Record<CatalogIconKey, { icon: React.ComponentProps<typeof Feather>['name']; tint: Tint }> = {
  shirts: { icon: 'shopping-bag', tint: 'azure' },
  outerwear: { icon: 'cloud-snow', tint: 'success' },
  formalwear: { icon: 'award', tint: 'honey' },
  'wash-fold': { icon: 'droplet', tint: 'azure' },
  'wash-iron': { icon: 'feather', tint: 'honey' },
  'dry-clean': { icon: 'wind', tint: 'success' },
  iron: { icon: 'feather', tint: 'honey' },
  delicates: { icon: 'feather', tint: 'azure' },
  // [Inc-21] the specialty service cards (Feather has no furniture glyphs — closest recognisable shapes).
  rug: { icon: 'square', tint: 'honey' },
  carpet: { icon: 'grid', tint: 'success' },
  sofa: { icon: 'box', tint: 'azure' },
  blinds: { icon: 'align-justify', tint: 'honey' },
};

/**
 * [Inc-21] The card footer, driven by the service's pricing model + unit + founder-set `priceFrom`:
 *   • priceFrom null                       → "Get a quote"  (NEVER a fake number — honesty firewall)
 *   • FROM_MEASURED (rug/carpet/…)         → "from $X" + "measured at pickup"
 *   • FIXED PER_KG (Wash & Fold)           → "from $X" + "per kg"
 *   • FIXED PER_LB (Wash & Fold, per lb)   → "from $X" + "per lb"   [Inc-24]
 *   • FIXED PER_ITEM / other               → "from $X" + "per item"
 */
/** [Inc-23] The default ItemKind for a booked line from a card (custody/tag only; pricing uses the service). */
function kindForCard(card: HomeServiceCardView): ItemKind {
  switch (card.icon) {
    case 'rug':
      return ItemKind.RUG;
    case 'carpet':
      return ItemKind.CARPET;
    case 'sofa':
      return ItemKind.UPHOLSTERY;
    case 'blinds':
      return ItemKind.BLIND;
    default:
      return ItemKind.GARMENT; // wash-fold / wash-iron / dry-clean / iron
  }
}

function priceFooter(category: HomeServiceCardView, currency: string): { quote: boolean; primary: string; sub: string | null } {
  if (!category.priceFrom) return { quote: true, primary: 'Get a quote', sub: null };
  const amt = `from ${money(category.priceFrom, currency)}`;
  if (category.pricingModel === PricingModel.FROM_MEASURED) return { quote: false, primary: amt, sub: 'measured at pickup' };
  if (category.unit === PricingUnit.PER_KG) return { quote: false, primary: amt, sub: 'per kg' };
  if (category.unit === PricingUnit.PER_LB) return { quote: false, primary: amt, sub: 'per lb' };
  if (category.unit === PricingUnit.PER_ITEM) return { quote: false, primary: amt, sub: 'per item' };
  return { quote: false, primary: amt, sub: null };
}

/** [Royal] A full-width service BAR (not a grid box) — icon chip · name + one-line description + price/quote,
 *  chevron. One scannable line per service; 3 services or 30 read the same way. */
function ServiceBar({
  category,
  currency,
  onPress,
}: {
  category: HomeServiceCardView;
  currency: string;
  onPress: () => void;
}): React.ReactElement {
  const { colors, radius, elevation } = useTheme();
  // A legacy/unknown icon key falls back to the neutral glyph rather than crashing the list.
  const look = (category.icon && isCatalogIconKey(category.icon) ? CATEGORY_ICONS[category.icon] : null) ?? { icon: 'grid' as const, tint: 'azure' as const };
  const footer = priceFooter(category, currency);

  return (
    <Pressable
      testID={`home-service-${category.id}`}
      onPress={() => {
        fireHaptic('selection');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${category.name} — book`}
    >
      <View style={[styles.bar, elevation.e1, { backgroundColor: colors.surface, borderColor: colors.hairline, borderRadius: radius.card }]}>
        <IconBadge icon={look.icon} tone={look.tint} size={48} />
        <View style={styles.barBody}>
          <Text variant="headline" weight="700" numberOfLines={1}>
            {category.name}
          </Text>
          {/* [Inc-36] One plain line only — the process-identifier chips (`category.features`) stay in the
              schema/console but the customer app doesn't render jargon. */}
          {category.description ? (
            <Text variant="footnote" color="secondary" numberOfLines={2} style={{ marginTop: 2 }}>
              {category.description}
            </Text>
          ) : null}
          <View style={styles.priceLine}>
            {footer.quote ? (
              <Text testID={`home-price-${category.id}`} variant="subhead" weight="700" color="secondary">
                {footer.primary}
              </Text>
            ) : (
              <>
                <Text testID={`home-price-${category.id}`} variant="subhead" weight="700" color="azure" tabular>
                  {footer.primary}
                </Text>
                {footer.sub ? (
                  <Text variant="caption" color="tertiary" style={{ marginLeft: 6 }}>
                    {footer.sub}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>
        <Feather name="chevron-right" size={20} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  pricingLink: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  list: { paddingHorizontal: 20, gap: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  barBody: { flex: 1, marginHorizontal: 14 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  stateCard: { marginHorizontal: 20, alignItems: 'center', paddingVertical: 28 },
});
