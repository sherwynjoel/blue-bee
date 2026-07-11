import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@blue-bee/api-client';
import { ItemKind, PricingModel, PricingUnit, isCatalogIconKey, type CatalogIconKey, type HomeServiceMenuView, type HomeServiceCardView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { money } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, EmptyState, SkeletonCard, Text, fireHaptic } from '../../components/ui';

/**
 * Home — the service grid (PRD §7A). A 2-up grid of the org's service categories, driven ENTIRELY by the
 * live catalog (`getDrycleanCatalog`): each card is a category's icon → title → description → feature tags →
 * a "from" price. Nothing here is hard-coded — `description`/`features`/`icon`/`priceFrom` all come from the
 * server (founder-editable in the console). The card degrades gracefully when a field is unset (missing copy
 * is simply omitted; a missing icon falls back). Tapping a card opens the existing Book flow.
 */
export function HomeScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client, me } = useSession();
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();

  const [catalog, setCatalog] = useState<HomeServiceMenuView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setCatalog(await client.getServiceMenu());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load our services.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
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
      {/* [Inc-33] Book as the Service tab's primary action (it absorbed the old center Book FAB). Lives in
          the shared header so it is reachable in every state — loading, error, empty, and the grid. Opens
          the general Book composer; tapping a specific card still pre-selects that service (below). */}
      <Button
        testID="service-book"
        label="Book a pickup"
        icon="plus"
        onPress={() => navigation.navigate('Book')}
        style={{ marginTop: space.lg }}
        haptic="medium"
      />
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="home-loading">
        {header}
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.cell}>
              <SkeletonCard />
            </View>
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
    >
      {header}
      {categories.length === 0 ? (
        <View style={{ paddingHorizontal: space.xl }}>
          <EmptyState
            icon="tag"
            title="No services yet"
            body="Our catalog is being set up. Check back soon, or start a booking."
            actionLabel="Book a pickup"
            actionIcon="plus"
            onAction={() => navigation.navigate('Book')}
          />
        </View>
      ) : (
        <View style={styles.grid}>
          {categories.map((cat) => (
            <ServiceCard
              key={cat.id}
              category={cat}
              currency={currency}
              // [Inc-23] Carry the card's backing service into Book so the order references the right
              // service → pricingModel. A card with no backing service yet (rate unset) opens the general
              // composer (undefined param).
              onPress={() =>
                navigation.navigate(
                  'Book',
                  cat.serviceId ? { serviceId: cat.serviceId, serviceName: cat.name, unit: cat.unit, kind: kindForCard(cat) } : undefined,
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

function ServiceCard({
  category,
  currency,
  onPress,
}: {
  category: HomeServiceCardView;
  currency: string;
  onPress: () => void;
}): React.ReactElement {
  const { colors, radius, elevation } = useTheme();
  // A legacy/unknown icon key falls back to the neutral glyph rather than crashing the grid.
  const look = (category.icon && isCatalogIconKey(category.icon) ? CATEGORY_ICONS[category.icon] : null) ?? { icon: 'grid' as const, tint: 'azure' as const };
  const tint = {
    azure: { bg: colors.azureTint, fg: colors.azure },
    honey: { bg: colors.honeyTint, fg: colors.honey },
    success: { bg: colors.successTint, fg: colors.success },
  }[look.tint];
  const features = category.features.slice(0, 4);
  const footer = priceFooter(category, currency);

  return (
    <View style={styles.cell}>
      <Pressable
        testID={`home-service-${category.id}`}
        onPress={() => {
          fireHaptic('selection');
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${category.name} — book`}
      >
        <View
          style={[
            styles.card,
            elevation.e1,
            { backgroundColor: colors.surface, borderColor: colors.hairline, borderRadius: radius.card },
          ]}
        >
          <View style={styles.cardBody}>
            <View style={[styles.iconCircle, { backgroundColor: tint.bg }]}>
              <Feather name={look.icon} size={24} color={tint.fg} />
            </View>
            <Text variant="headline" weight="700" center numberOfLines={1} style={styles.title}>
              {category.name}
            </Text>
            {category.description ? (
              <Text variant="footnote" color="secondary" center numberOfLines={2} style={styles.desc}>
                {category.description}
              </Text>
            ) : null}
            {features.length > 0 ? (
              <View style={styles.tags}>
                {features.map((f) => (
                  <View key={f} style={[styles.tag, { backgroundColor: colors.subtle }]}>
                    <Text variant="caption" weight="600" color="secondary">
                      {f}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <View style={[styles.footer, { borderTopColor: colors.hairline, backgroundColor: colors.subtle }]}>
            <View style={{ flex: 1 }}>
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
                    <Text variant="caption" color="tertiary">
                      {footer.sub}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
            <Feather name="chevron-right" size={18} color={colors.textTertiary} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14 },
  cell: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
  card: { borderWidth: 1, overflow: 'hidden' },
  cardBody: { padding: 14, alignItems: 'center' },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { marginBottom: 2 },
  desc: { minHeight: 36 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 10 },
  tag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  stateCard: { marginHorizontal: 20, alignItems: 'center', paddingVertical: 28 },
});
