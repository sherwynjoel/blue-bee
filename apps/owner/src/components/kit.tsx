import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Badge, Card, MIN_TARGET, Text, haptics, toneColors, useTheme, type Tone } from '@blue-bee/ui';

const ZERO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** Safe-area insets that don't throw when there's no provider (e.g. screens rendered bare in tests). */
function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO_INSETS;
}

/**
 * The Daylight operator COMPOSITES — the driver/owner-shell pieces built on top of the shared
 * `@blue-bee/ui` primitives (Text / Button / Card / Badge / Input / StatTile + the theme layer). The
 * genuinely-shared primitives now live in `@blue-bee/ui`; this file keeps only the operator-specific
 * chrome the shared package doesn't (yet) provide — the themed `Screen` canvas, `Row`/`Field` list
 * shells, the bottom `Sheet` + `SheetOption`, `Segmented`, skeletons, `EmptyState`, `SectionHeader`,
 * `Divider`, and the `useToast` inline-notice hook. Everything reads from the shared `useTheme()` so the
 * driver and owner still render as one family. This file is byte-identical between apps/driver and
 * apps/owner — keep it that way.
 */

export type FeatherName = React.ComponentProps<typeof Feather>['name'];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A reusable spring press-scale. Press → `to`, release → 1, both on a snappy spring. */
function usePressScale(to = 0.97): { scale: Animated.Value; pressIn: () => void; pressOut: () => void } {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = useCallback(() => {
    Animated.spring(scale, { toValue: to, useNativeDriver: true, friction: 7, tension: 180 }).start();
  }, [scale, to]);
  const pressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 160 }).start();
  }, [scale]);
  return { scale, pressIn, pressOut };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen — themed canvas wrapper (scroll or static)
// ─────────────────────────────────────────────────────────────────────────────

export function Screen({
  children,
  scroll = false,
  padded = true,
  refreshControl,
  contentStyle,
  testID,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshControl?: React.ReactElement;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}): React.ReactElement {
  const t = useTheme();
  const insets = useInsets();
  const pad: ViewStyle = {
    padding: padded ? t.space.lg : 0,
    paddingBottom: (padded ? t.space.lg : 0) + insets.bottom + 8,
  };
  if (scroll) {
    return (
      <ScrollView
        testID={testID}
        style={{ flex: 1, backgroundColor: t.colors.canvas }}
        contentContainerStyle={[pad, contentStyle]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }
  return <View testID={testID} style={[{ flex: 1, backgroundColor: t.colors.canvas }, pad, contentStyle]}>{children}</View>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon
// ─────────────────────────────────────────────────────────────────────────────

export function Icon({ name, size = 20, color }: { name: FeatherName; size?: number; color?: string }): React.ReactElement {
  const t = useTheme();
  return <Feather name={name} size={size} color={color ?? t.colors.text} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field — a label / value line
// ─────────────────────────────────────────────────────────────────────────────

export function Field({
  label,
  value,
  mono,
  valueColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
}): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 12 }}>
      <Text variant="subhead" color={t.colors.textSecondary}>
        {label}
      </Text>
      <Text variant="subhead" weight="600" mono={mono} tabular={mono} color={valueColor ?? t.colors.text} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — a pressable inset surface (list item shell)
// ─────────────────────────────────────────────────────────────────────────────

export function Row({
  children,
  onPress,
  disabled,
  chevron,
  testID,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  chevron?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const t = useTheme();
  const { scale, pressIn, pressOut } = usePressScale(0.985);
  const base: ViewStyle = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.colors.hairline,
    padding: t.space.lg,
    ...t.elevation.e1,
  };
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>{children}</View>
      {chevron && onPress && !disabled ? <Feather name="chevron-right" size={20} color={t.colors.textTertiary} /> : null}
    </View>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={[base, style]}>
        {content}
      </View>
    );
  }
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={
        disabled
          ? undefined
          : () => {
              haptics.selection();
              onPress();
            }
      }
      onPressIn={disabled ? undefined : pressIn}
      onPressOut={disabled ? undefined : pressOut}
      style={[base, { transform: [{ scale }] }, disabled ? { opacity: 0.6 } : null, style]}
    >
      {content}
    </AnimatedPressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusPill — a label-only Badge (§5.4 status)
// ─────────────────────────────────────────────────────────────────────────────

export function StatusPill({ label, tone = 'neutral', dot }: { label: string; tone?: Tone; dot?: boolean }): React.ReactElement {
  return (
    <Badge tone={tone} dot={dot}>
      {label}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 8,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: t.colors.skeleton, opacity: pulse }, style]} />;
}

/** A card-shaped skeleton placeholder for list/grid loading. */
export function SkeletonCard({ lines = 2 }: { lines?: number }): React.ReactElement {
  const t = useTheme();
  return (
    <Card style={{ marginBottom: t.space.md }}>
      <Skeleton width="55%" height={18} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '40%' : '85%'} height={12} style={{ marginBottom: 8 }} />
      ))}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState
// ─────────────────────────────────────────────────────────────────────────────

export function EmptyState({
  icon = 'inbox',
  title,
  message,
  action,
  testID,
}: {
  icon?: FeatherName;
  title: string;
  message?: string;
  action?: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const t = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xxl, gap: t.space.md }}>
      <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: t.colors.subtle, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={30} color={t.colors.textTertiary} />
      </View>
      <Text variant="title3" center>
        {title}
      </Text>
      {message ? (
        <Text variant="subhead" color={t.colors.textSecondary} center>
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: t.space.sm, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet — bottom sheet modal
// ─────────────────────────────────────────────────────────────────────────────

export function Sheet({
  visible,
  onClose,
  title,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const t = useTheme();
  const insets = useInsets();
  const translateY = useRef(new Animated.Value(48)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9, tension: 80 }),
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(48);
      opacity.setValue(0);
    }
  }, [visible, translateY, opacity]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable testID={testID} style={{ flex: 1, backgroundColor: t.colors.scrim, justifyContent: 'flex-end' }} onPress={onClose}>
        <Animated.View style={{ opacity }}>
          <Pressable onPress={() => undefined}>
            <Animated.View
              style={{
                backgroundColor: t.colors.surface,
                borderTopLeftRadius: t.radius.sheet,
                borderTopRightRadius: t.radius.sheet,
                paddingHorizontal: t.space.lg,
                paddingTop: t.space.md,
                paddingBottom: insets.bottom + t.space.lg,
                transform: [{ translateY }],
                ...t.elevation.sheet,
              }}
            >
              <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: t.colors.hairline, marginBottom: t.space.md }} />
              {title ? (
                <Text variant="title3" style={{ marginBottom: t.space.sm }}>
                  {title}
                </Text>
              ) : null}
              {children}
            </Animated.View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/** A tappable option row for use inside a Sheet (e.g. the §5.4 reason picker). */
export function SheetOption({
  label,
  icon,
  tone,
  onPress,
  testID,
}: {
  label: string;
  icon?: FeatherName;
  tone?: Tone;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  const t = useTheme();
  const color = tone ? toneColors(t.colors, tone).ink : t.colors.text;
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      android_ripple={{ color: t.colors.surfacePressed }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: MIN_TARGET,
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: t.radius.input,
        backgroundColor: pressed ? t.colors.surfacePressed : 'transparent',
      })}
    >
      {icon ? <Feather name={icon} size={20} color={color} /> : null}
      <Text variant="headline" color={color} style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Segmented control (the in-screen "TabBar" primitive)
// ─────────────────────────────────────────────────────────────────────────────

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}): React.ReactElement {
  const t = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', backgroundColor: t.colors.subtle, borderRadius: t.radius.input, padding: 3 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            hitSlop={6}
            onPress={() => {
              if (!active) {
                haptics.selection();
                onChange(o.value);
              }
            }}
            style={{
              flex: 1,
              minHeight: 44,
              paddingVertical: 10,
              borderRadius: t.radius.input - 3,
              alignItems: 'center',
              justifyContent: 'center',
              ...(active ? { backgroundColor: t.colors.surface, ...t.elevation.e1 } : null),
            }}
          >
            <Text variant="footnote" weight={active ? '700' : '500'} color={active ? t.colors.text : t.colors.textSecondary}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionHeader / Divider
// ─────────────────────────────────────────────────────────────────────────────

export function SectionHeader({ children, style }: { children: string; style?: StyleProp<TextStyle> }): React.ReactElement {
  const t = useTheme();
  return (
    <Text variant="overline" color={t.colors.textTertiary} style={[{ marginTop: t.space.xl, marginBottom: t.space.sm }, style]}>
      {children.toUpperCase()}
    </Text>
  );
}

export function Divider(): React.ReactElement {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.hairline, marginVertical: t.space.sm }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast — non-blocking inline notice (calm 409 / confirmations)
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ message, tone }: { message: string; tone: Tone }): React.ReactElement {
  const t = useTheme();
  const insets = useInsets();
  const tc = toneColors(t.colors, tone);
  const y = useRef(new Animated.Value(20)).current;
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, { toValue: 0, useNativeDriver: true, friction: 8, tension: 90 }),
      Animated.timing(o, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [y, o]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16, opacity: o, transform: [{ translateY: y }] }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.button,
          borderWidth: 1,
          borderColor: t.colors.hairline,
          padding: 14,
          ...t.elevation.e2,
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tc.solid }} />
        <Text variant="subhead" color={t.colors.text} style={{ flex: 1 }}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

export function useToast(): { toast: (message: string, tone?: Tone) => void; node: React.ReactElement | null } {
  const [state, setState] = useState<{ message: string; tone: Tone; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const toast = useCallback((message: string, tone: Tone = 'neutral') => {
    seq.current += 1;
    setState({ message, tone, key: seq.current });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 3400);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const node = state ? <Toast key={state.key} message={state.message} tone={state.tone} /> : null;
  return { toast, node };
}
