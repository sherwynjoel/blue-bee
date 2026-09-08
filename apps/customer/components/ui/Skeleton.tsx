import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, useReducedMotion } from '../../theme';
import { Card } from '@blue-bee/ui';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** A shimmering placeholder block (opacity pulse; static under reduced motion). */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps): React.ReactElement {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);

  const opacity = reduce ? 0.6 : v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.subtle, opacity }, style]} />;
}

/** A placeholder card matching the orders-list row shape (used while the first page loads). */
export function SkeletonCard(): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.rowTop}>
        <Skeleton width={96} height={18} />
        <Skeleton width={74} height={22} radius={11} />
      </View>
      <Skeleton width="60%" height={13} style={{ marginTop: 14 }} />
      <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
      <Skeleton width="40%" height={13} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
});
