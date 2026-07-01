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
          {cat.items.map((it) => {
            const qty = qtyFor(it.id);
            return (
              <View key={it.id} testID={`dryclean-item-${it.id}`} style={[styles.itemRow, { borderColor: colors.hairline }]}>
                <View style={[styles.thumb, { backgroundColor: colors.subtle }]}>
                  {it.imageUrl ? (
                    <Image testID={`dryclean-photo-${it.id}`} source={{ uri: it.imageUrl }} style={styles.thumbImg} />
                  ) : (
                    <Feather name="image" size={18} color={colors.textTertiary} />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="subhead" weight="600">
                    {it.name}
                  </Text>
                  <Text testID={`dryclean-price-${it.id}`} variant="footnote" color="secondary" tabular>
                    {money(it.price, catalog.currency)} each
                  </Text>
                </View>
                <View style={styles.stepper}>
                  {qty > 0 ? (
                    <>
                      <Stepper icon="minus" label={`Remove one ${it.name}`} onPress={() => { fireHaptic('selection'); onRemove(it.id); }} colors={colors} />
                      <Text testID={`dryclean-qty-${it.id}`} variant="subhead" weight="700" tabular style={{ minWidth: 22, textAlign: 'center' }}>
                        {qty}
                      </Text>
                    </>
                  ) : null}
                  <Stepper icon="plus" label={`Add one ${it.name}`} onPress={() => { fireHaptic('success'); onAdd(it.id); }} colors={colors} primary />
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

function Stepper({
  icon,
  label,
  onPress,
  colors,
  primary,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  primary?: boolean;
}): React.ReactElement {
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
  category: { marginTop: 6 },
  categoryHead: { marginBottom: 8, marginTop: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  thumb: { width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: 48, height: 48 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
