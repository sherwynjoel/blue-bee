import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DrycleanCatalogView } from '@blue-bee/shared';
import { useTheme } from '../../theme';
import { Card, Text, fireHaptic } from '../../components/ui';
import { money } from '../format';

/**
 * [Inc-17] The visual dry-clean catalog picker in the Book flow. Renders the SERVER-resolved catalog
 * (categories → items with a photo + a price the server already resolved for this caller — corporate
 * override or base) and lets the customer add/remove per-item garments. Selecting an item feeds the
 * EXISTING order line-item staging (unit ITEM) — no parallel cart, no client-side pricing. When corporate
 * pricing applies, a badge names the account (the Inc-16 "corporate pricing applied" signal).
 *
 * UX (feature/customer-ux): a 2-up card grid matching the founder's reference — a photo, the item name,
 * and a price footer per card. Everything here is data-driven from `getDrycleanCatalog()` (photo, name,
 * server-resolved price); the reference's per-item text descriptions and the WASH+TUMBLE-DRY feature tags
 * are NOT in any API, so they are intentionally omitted rather than hard-coded. Icons/circles are pure
 * presentation (the fallback when an item has no photo).
 */
export function DrycleanPicker({
  catalog,
  qtyFor,
  onAdd,
  onRemove,
}: {
  catalog: DrycleanCatalogView;
  qtyFor: (serviceId: string) => number;
  onAdd: (serviceId: string) => void;
  onRemove: (serviceId: string) => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (catalog.categories.length === 0) return null;

  return (
    <Card title="Dry cleaning">
      {catalog.pricingAccountName ? (
        <View style={[styles.corpNote, { backgroundColor: colors.azureTint }]} testID="dryclean-corp-note">
          <Feather name="award" size={14} color={colors.azure} />
          <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6, flex: 1 }}>
            Corporate pricing — {catalog.pricingAccountName}
          </Text>
        </View>
      ) : null}

      {catalog.categories.map((cat) => (
        <View key={cat.id} testID={`dryclean-category-${cat.id}`} style={styles.category}>
          <Text variant="subhead" weight="700" style={styles.categoryHead}>
            {cat.name}
          </Text>
          <View style={styles.grid}>
            {cat.items.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                currency={catalog.currency}
                qty={qtyFor(it.id)}
                onAdd={() => {
                  fireHaptic('success');
                  onAdd(it.id);
                }}
                onRemove={() => {
                  fireHaptic('selection');
                  onRemove(it.id);
                }}
              />
            ))}
          </View>
        </View>
      ))}
    </Card>
  );
}

/** One catalog item as a reference-style card: photo → name → price footer, with an add / +− stepper. */
function ItemCard({
  item,
  currency,
  qty,
  onAdd,
  onRemove,
}: {
  item: DrycleanCatalogView['categories'][number]['items'][number];
  currency: string;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}): React.ReactElement {
  const { colors, radius, elevation } = useTheme();
  const selected = qty > 0;
  return (
    <View style={styles.cell}>
      <View
        testID={`dryclean-item-${item.id}`}
        style={[
          styles.card,
          elevation.e1,
          {
            backgroundColor: colors.surface,
            borderColor: selected ? colors.azure : colors.hairline,
            borderRadius: radius.card,
          },
        ]}
      >
        <View style={[styles.media, { backgroundColor: colors.subtle }]}>
          {item.imageUrl ? (
            <Image testID={`dryclean-photo-${item.id}`} source={{ uri: item.imageUrl }} style={styles.mediaImg} resizeMode="cover" />
          ) : (
            <View style={[styles.iconCircle, { backgroundColor: colors.azureTint }]}>
              <Feather name="shopping-bag" size={22} color={colors.azure} />
            </View>
          )}
          {selected ? (
            <View style={[styles.qtyBadge, { backgroundColor: colors.azure }]}>
              <Text variant="caption" weight="700" style={{ color: colors.onAzure }} tabular>
                {qty}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <Text variant="subhead" weight="600" numberOfLines={2} style={styles.name}>
            {item.name}
          </Text>
          <View style={styles.footer}>
            <View style={styles.priceWrap}>
              <Text testID={`dryclean-price-${item.id}`} variant="subhead" weight="700" color="azure" tabular>
                {money(item.price, currency)}
              </Text>
              <Text variant="caption" color="tertiary">
                each
              </Text>
            </View>
            {selected ? (
              <View style={styles.stepper}>
                <StepBtn icon="minus" label={`Remove one ${item.name}`} onPress={onRemove} />
                {/* children MUST stay the bare number — DrycleanPicker.test asserts props.children === qty */}
                <Text testID={`dryclean-qty-${item.id}`} variant="subhead" weight="700" tabular style={styles.qtyText}>
                  {qty}
                </Text>
                <StepBtn icon="plus" label={`Add one ${item.name}`} onPress={onAdd} primary />
              </View>
            ) : (
              <StepBtn icon="plus" label={`Add one ${item.name}`} onPress={onAdd} primary />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function StepBtn({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  primary?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.stepBtn, { backgroundColor: primary ? colors.azure : colors.surface, borderColor: primary ? colors.azure : colors.hairline }]}
    >
      <Feather name={icon} size={15} color={primary ? colors.onAzure : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  corpNote: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 12 },
  category: { marginTop: 6 },
  categoryHead: { marginBottom: 10, marginTop: 6 },
  // 2-up grid: negative row margin cancels the per-cell gutter so outer cards sit flush with card padding.
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  cell: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
  card: { borderWidth: 1.5, overflow: 'hidden' },
  media: { height: 104, alignItems: 'center', justifyContent: 'center' },
  mediaImg: { width: '100%', height: '100%' },
  iconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  qtyBadge: { position: 'absolute', top: 8, right: 8, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 10 },
  name: { minHeight: 40 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  priceWrap: { flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  qtyText: { minWidth: 18, textAlign: 'center' },
  stepBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
