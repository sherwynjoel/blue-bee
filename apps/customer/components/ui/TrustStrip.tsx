import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card, Text } from '@blue-bee/ui';
import { IconBadge, type IconTone } from './IconBadge';

/**
 * The ONE trust/value-prop strip. Dashboard, Orders, Services and Book each used to hand-roll their own
 * layout for the same concept (four bespoke variants); this is the single shared motif.
 *
 * Layouts, by item count (one rhythm everywhere):
 *  - 1–2 items → horizontal banner rows (icon chip left, label + caption right), hairline-divided;
 *  - 3+ items → a 2-column grid of compact cells (icon chip above label + caption).
 * An item with `onPress` is a real, tappable affordance (accessibilityRole="button"); without one it is
 * static chrome. Copy rules stay the caller's job: no invented counts or ratings.
 */
export interface TrustStripItem {
  icon: React.ComponentProps<typeof Feather>['name'];
  tone: IconTone;
  label: string;
  caption?: string;
  onPress?: () => void;
  testID?: string;
}

export interface TrustStripProps {
  items: TrustStripItem[];
  style?: ViewStyle;
  testID?: string;
}

function GridCell({ item }: { item: TrustStripItem }): React.ReactElement {
  const body = (
    <>
      <IconBadge icon={item.icon} tone={item.tone} size={34} />
      <Text variant="caption" weight="700" style={styles.cellLabel} numberOfLines={1}>
        {item.label}
      </Text>
      {item.caption ? (
        <Text variant="caption" color="secondary" numberOfLines={2} style={styles.cellCaption}>
          {item.caption}
        </Text>
      ) : null}
    </>
  );
  if (item.onPress) {
    return (
      <Pressable testID={item.testID} onPress={item.onPress} accessibilityRole="button" accessibilityLabel={item.label} hitSlop={4} style={styles.cell}>
        {body}
      </Pressable>
    );
  }
  return (
    <View testID={item.testID} style={styles.cell}>
      {body}
    </View>
  );
}

function BannerRow({ item }: { item: TrustStripItem }): React.ReactElement {
  const body = (
    <>
      <IconBadge icon={item.icon} tone={item.tone} size={36} />
      <View style={styles.bannerText}>
        <Text variant="subhead" weight="700">
          {item.label}
        </Text>
        {item.caption ? (
          <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
            {item.caption}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (item.onPress) {
    return (
      <Pressable testID={item.testID} onPress={item.onPress} accessibilityRole="button" accessibilityLabel={item.label} hitSlop={4} style={styles.bannerRow}>
        {body}
      </Pressable>
    );
  }
  return (
    <View testID={item.testID} style={styles.bannerRow}>
      {body}
    </View>
  );
}

export function TrustStrip({ items, style, testID }: TrustStripProps): React.ReactElement {
  const grid = items.length > 2;
  return (
    <Card testID={testID} style={style}>
      {grid ? (
        <View style={styles.grid}>
          {items.map((item) => (
            <GridCell key={item.label} item={item} />
          ))}
        </View>
      ) : (
        items.map((item, i) => (
          <View key={item.label} style={i > 0 ? styles.bannerGap : null}>
            <BannerRow item={item} />
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', paddingVertical: 8, paddingRight: 8 },
  cellLabel: { marginTop: 6 },
  cellCaption: { marginTop: 1 },
  bannerRow: { flexDirection: 'row', alignItems: 'center' },
  bannerText: { flex: 1, marginLeft: 12 },
  bannerGap: { marginTop: 14 },
});
