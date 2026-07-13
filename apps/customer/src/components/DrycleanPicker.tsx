import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DrycleanCatalogView } from '@blue-bee/shared';
import { useTheme } from '../../theme';
import { Text, fireHaptic } from '../../components/ui';
import { money } from '../format';

/**
 * [Inc-17] The garment picker in the Book flow. Renders the SERVER-resolved catalog (categories → items with
 * a price the server already resolved for this caller — corporate override or base) and lets the customer
 * add/remove per-item garments. Selecting an item feeds the EXISTING order line-item staging (unit ITEM) — no
 * parallel cart, no client-side pricing. When corporate pricing applies, a badge names the account.
 *
 * [Inc-39] A LIST, not a card grid. It was a 2-up gallery of photo cards, which is the right shape for
 * *browsing* and the wrong one for what a customer is actually doing here: running down a known list of their
 * own garments and tapping "+" a few times. A list puts the name, the price and the stepper on one scannable
 * line, so 3 garments or 30 read the same way and the thumb never leaves the right edge. The photo survives as
 * a thumbnail (it aids recognition; it just shouldn't set the layout).
 *
 * No wrapping Card and no "Dry cleaning" heading: the screen that hosts this already names the service the
 * founder chose ("Book Dry Cleaning"). It never hard-codes what that service is called.
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

  // [Inc-24] Render categories — and each category's items — in the order the founder arranged in the
  // console. The server already sorts by sortOrder; sorting here too makes the rendered order a pure
  // function of sortOrder rather than of response order.
  const categories = [...catalog.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((cat) => ({ ...cat, items: [...cat.items].sort((a, b) => a.sortOrder - b.sortOrder) }));

  return (
    <View>
      {catalog.pricingAccountName ? (
        <View style={[styles.corpNote, { backgroundColor: colors.azureTint }]} testID="dryclean-corp-note">
          <Feather name="award" size={14} color={colors.azure} />
          <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6, flex: 1 }}>
            Corporate pricing — {catalog.pricingAccountName}
          </Text>
        </View>
      ) : null}

      {categories.map((cat) => (
        <View key={cat.id} testID={`dryclean-category-${cat.id}`} style={styles.category}>
          <Text variant="footnote" weight="700" color="secondary" style={styles.categoryHead}>
            {cat.name.toUpperCase()}
          </Text>
          <View style={[styles.list, { borderColor: colors.hairline, backgroundColor: colors.surface }]}>
            {cat.items.map((it, idx) => (
              <ItemRow
                key={it.id}
                item={it}
                currency={catalog.currency}
                qty={qtyFor(it.id)}
                last={idx === cat.items.length - 1}
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
    </View>
  );
}

/** One garment as a scannable row: thumbnail · name + price · stepper, all on one line. */
function ItemRow({
  item,
  currency,
  qty,
  last,
  onAdd,
  onRemove,
}: {
  item: DrycleanCatalogView['categories'][number]['items'][number];
  currency: string;
  qty: number;
  last: boolean;
  onAdd: () => void;
  onRemove: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const selected = qty > 0;
  return (
    <View
      testID={`dryclean-item-${item.id}`}
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
        selected && { backgroundColor: colors.azureTint },
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: colors.subtle }]}>
        {item.imageUrl ? (
          <Image testID={`dryclean-photo-${item.id}`} source={{ uri: item.imageUrl }} style={styles.thumbImg} resizeMode="cover" />
        ) : (
          <Feather name="shopping-bag" size={18} color={colors.azure} />
        )}
      </View>

      <View style={styles.info}>
        <Text variant="subhead" weight="600" numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.priceLine}>
          {/* children MUST stay the bare money string — the picker test asserts on this node. */}
          <Text testID={`dryclean-price-${item.id}`} variant="footnote" weight="600" color="azure" tabular>
            {money(item.price, currency)}
          </Text>
          <Text variant="caption" color="tertiary" style={{ marginLeft: 4 }}>
            each
          </Text>
        </View>
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
      <Feather name={icon} size={16} color={primary ? colors.onAzure : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  corpNote: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 12 },
  category: { marginTop: 4, marginBottom: 12 },
  categoryHead: { marginBottom: 6, letterSpacing: 0.6 },
  // The rows share one bordered container, so the group reads as a single list rather than N floating cards.
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, minHeight: 60 },
  thumb: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyText: { minWidth: 18, textAlign: 'center' },
  stepBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
