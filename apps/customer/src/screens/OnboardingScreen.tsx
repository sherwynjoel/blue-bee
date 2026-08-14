import React, { useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Button, Text } from '../../components/ui';

/**
 * First-run onboarding — a 4-pane carousel shown once before login (gated by a secure-store flag in
 * App.tsx). The illustrations are the founder's reference art, cropped to the hero band and rebuilt with
 * honest Royal copy (no invented stats or claims — every line describes what the app actually does).
 */

type Pane =
  | { kind: 'logo'; eyebrow: string; title: string; body: string }
  | { kind: 'art'; art: number; eyebrow: string; title: string; body: string };

const PANES: Pane[] = [
  {
    kind: 'logo',
    eyebrow: 'WELCOME',
    title: 'Royal Dry Cleaning\n& Laundry',
    body: 'Premium dry cleaning and laundry — picked up from your door and delivered back fresh.',
  },
  {
    kind: 'art',
    art: require('../../assets/brand/onb-book.png'),
    eyebrow: 'BOOK IN SECONDS',
    title: 'Booking that fits\nyour day.',
    body: 'Pick your items, choose a pickup window, and we take it from there.',
  },
  {
    kind: 'art',
    art: require('../../assets/brand/onb-pickup.png'),
    eyebrow: 'WE COME TO YOU',
    title: 'Doorstep pickup\n& delivery.',
    body: 'Your driver collects at your door and brings everything back when it is ready.',
  },
  {
    kind: 'art',
    art: require('../../assets/brand/onb-deliver.png'),
    eyebrow: 'FRESH & READY',
    title: 'Clean clothes,\ndelivered.',
    body: 'Follow your order live and get everything back professionally cleaned.',
  },
];

export function OnboardingScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = PANES.length - 1;
  const artW = width - 48;
  const artH = Math.min(artW * 0.82, 340);

  const goTo = (p: number): void => {
    scrollRef.current?.scrollTo({ x: p * width, animated: true });
    setPage(p);
  };
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas, paddingTop: insets.top }]} testID="onboarding">
      <StatusBar style="dark" />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
      >
        {PANES.map((pane, i) => (
          <View key={i} style={{ width, paddingHorizontal: 24, paddingTop: 12 }}>
            <View style={[styles.artCard, { width: artW, height: artH, backgroundColor: '#EAF2FC' }]}>
              {pane.kind === 'logo' ? (
                <Image source={require('../../assets/brand/royal-logo.png')} style={{ width: '78%', height: '78%' }} resizeMode="contain" />
              ) : (
                <Image source={pane.art} style={{ width: '92%', height: '92%' }} resizeMode="contain" />
              )}
            </View>
            <View style={styles.copy}>
              <View style={[styles.eyebrow, { backgroundColor: colors.azureTint }]}>
                <Text variant="caption" weight="700" style={{ color: colors.azure, letterSpacing: 1 }}>
                  {pane.eyebrow}
                </Text>
              </View>
              <Text variant="title1" weight="700" style={{ marginTop: 14 }}>
                {pane.title}
              </Text>
              <Text variant="body" color="secondary" style={{ marginTop: 10 }}>
                {pane.body}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Button
          label={page === last ? 'Get Started' : 'Next'}
          onPress={() => (page === last ? onDone() : goTo(page + 1))}
          testID="onboarding-next"
        />
        <View style={styles.footRow}>
          <View style={styles.dots}>
            {PANES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, { width: i === page ? 20 : 7, backgroundColor: i === page ? colors.azure : colors.hairline }]}
              />
            ))}
          </View>
          {page < last ? (
            <Pressable onPress={onDone} testID="onboarding-skip" hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip">
              <Text variant="subhead" weight="600" style={{ color: colors.textSecondary }}>
                Skip
              </Text>
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  artCard: { borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 8 },
  copy: { paddingTop: 24 },
  eyebrow: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 999 },
});
