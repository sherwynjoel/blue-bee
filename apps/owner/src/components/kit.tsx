import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type DimensionValue,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { haptics } from './haptics';
import { MIN_TARGET, tabular, toneColors, useTheme, type Theme, type Tone, type TypeVariant } from '../theme';

const ZERO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** Safe-area insets that don't throw when there's no provider (e.g. screens rendered bare in tests). */
function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO_INSETS;
}

/**
 * The Daylight operator primitives kit — the single shared vocabulary both ops apps render on, so the
 * driver and owner read as one family. Everything is tokenised (light/dark via `useTheme`), springs
 * with RN Animated (press scale .97), and taps the shared haptics. This file is byte-identical between
 * apps/driver and apps/owner — keep it that way.
 */

export type FeatherName = React.ComponentProps<typeof Feather>['name'];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A reusable spring press-scale. Press → 0.97, release → 1, both on a snappy spring. */
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
// Text
// ─────────────────────────────────────────────────────────────────────────────

export interface TextProps {
  variant?: TypeVariant;
  color?: string;
  weight?: TextStyle['fontWeight'];
  center?: boolean;
  /** True monospace family (IDs / timestamps). */
  mono?: boolean;
  /** Tabular figures (counts / ETAs that update in place). */
  tabular?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityRole?: 'header' | 'text' | 'alert' | 'none';
  children: React.ReactNode;
}

export function Text({
  variant = 'body',
  color,
  weight,
  center,
  mono,
  tabular: tab,
  numberOfLines,
  style,
  testID,
  accessibilityRole,
  children,
}: TextProps): React.ReactElement {
  const t = useTheme();
  const resolved: TextStyle = {
    ...t.type[variant],
    color: color ?? t.color.text,
    ...(weight ? { fontWeight: weight } : null),
    ...(center ? { textAlign: 'center' } : null),
    ...(mono ? { fontFamily: t.font.mono } : null),
    ...(tab ? tabular : null),
  };
  return (
    <RNText testID={testID} accessibilityRole={accessibilityRole} numberOfLines={numberOfLines} style={[resolved, style]}>
      {children}
    </RNText>
  );
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
    padding: padded ? t.spacing.lg : 0,
    paddingBottom: (padded ? t.spacing.lg : 0) + insets.bottom + 8,
  };
  if (scroll) {
    return (
      <ScrollView
        testID={testID}
        style={{ flex: 1, backgroundColor: t.color.canvas }}
        contentContainerStyle={[pad, contentStyle]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }
  return <View testID={testID} style={[{ flex: 1, backgroundColor: t.color.canvas }, pad, contentStyle]}>{children}</View>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon
// ─────────────────────────────────────────────────────────────────────────────

export function Icon({ name, size = 20, color }: { name: FeatherName; size?: number; color?: string }): React.ReactElement {
  const t = useTheme();
  return <Feather name={name} size={size} color={color ?? t.color.text} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'lg';
export type HapticKind = 'tap' | 'medium' | 'success' | 'warning' | 'none';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  disabled?: boolean;
  icon?: FeatherName;
  iconRight?: FeatherName;
  fullWidth?: boolean;
  haptic?: HapticKind;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  busy = false,
  disabled = false,
  icon,
  iconRight,
  fullWidth = false,
  haptic = 'tap',
  testID,
  style,
}: ButtonProps): React.ReactElement {
  const t = useTheme();
  const { scale, pressIn, pressOut } = usePressScale();
  const off = disabled || busy;

  const fg =
    variant === 'primary' ? t.color.onAzure : variant === 'danger' ? '#FFFFFF' : variant === 'ghost' ? t.color.azure : t.color.text;

  const variantStyle: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: t.color.azure, ...t.shadow.card }
      : variant === 'danger'
        ? { backgroundColor: t.color.danger, ...t.shadow.card }
        : variant === 'secondary'
          ? { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.hairline }
          : { backgroundColor: 'transparent' };

  const container: ViewStyle = {
    minHeight: size === 'lg' ? 56 : MIN_TARGET,
    borderRadius: t.radius.button,
    paddingHorizontal: size === 'lg' ? 22 : 18,
    paddingVertical: size === 'lg' ? 14 : 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...variantStyle,
    ...(fullWidth ? { alignSelf: 'stretch' } : null),
  };

  const handlePress = (): void => {
    if (off) return;
    if (haptic !== 'none') haptics[haptic]();
    onPress();
  };

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={off ? undefined : handlePress}
      onPressIn={off ? undefined : pressIn}
      onPressOut={off ? undefined : pressOut}
      style={[container, { transform: [{ scale }], opacity: off ? 0.55 : 1 }, style]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={size === 'lg' ? 20 : 18} color={fg} /> : null}
          <RNText style={{ color: fg, fontSize: size === 'lg' ? 18 : 17, fontWeight: '600' }}>{label}</RNText>
          {iconRight ? <Feather name={iconRight} size={size === 'lg' ? 20 : 18} color={fg} /> : null}
        </>
      )}
    </AnimatedPressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────────

export interface InputProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  icon?: FeatherName;
  testID?: string;
  /** Large, glove-friendly figures (OTP code). */
  big?: boolean;
}

export function Input({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  autoCapitalize,
  autoCorrect,
  icon,
  testID,
  big,
}: InputProps): React.ReactElement {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: t.color.surface,
        borderWidth: 1.5,
        borderColor: focused ? t.color.azure : t.color.hairline,
        borderRadius: t.radius.input,
        paddingHorizontal: 14,
        minHeight: 54,
      }}
    >
      {icon ? <Feather name={icon} size={18} color={focused ? t.color.azure : t.color.textFaint} /> : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.color.textFaint}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          color: t.color.text,
          fontSize: big ? 26 : 18,
          fontWeight: big ? '700' : '400',
          letterSpacing: big ? 6 : 0,
          paddingVertical: 14,
          ...(big ? tabular : null),
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────────

export function Card({
  children,
  padded = true,
  style,
}: {
  children: React.ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.color.surface,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.color.hairline,
          ...t.shadow.card,
          ...(padded ? { padding: t.spacing.lg } : null),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
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
      <Text variant="subhead" color={t.color.textMuted}>
        {label}
      </Text>
      <Text variant="subhead" weight="600" mono={mono} tabular={mono} color={valueColor ?? t.color.text} style={{ flexShrink: 1, textAlign: 'right' }}>
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
    backgroundColor: t.color.surface,
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.color.hairline,
    padding: t.spacing.lg,
    ...t.shadow.card,
  };
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>{children}</View>
      {chevron && onPress && !disabled ? <Feather name="chevron-right" size={20} color={t.color.textFaint} /> : null}
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
// Badge / StatusPill
// ─────────────────────────────────────────────────────────────────────────────

export function Badge({
  tone = 'neutral',
  dot,
  icon,
  children,
  style,
}: {
  tone?: Tone;
  dot?: boolean;
  icon?: FeatherName;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const t = useTheme();
  const tc = toneColors(t.color, tone);
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          alignSelf: 'flex-start',
          backgroundColor: tc.bg,
          borderRadius: t.radius.pill,
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tc.solid }} /> : null}
      {icon ? <Feather name={icon} size={12} color={tc.ink} /> : null}
      <Text variant="caption" weight="700" color={tc.ink}>
        {children}
      </Text>
    </View>
  );
}

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
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: t.color.skeleton, opacity: pulse }, style]} />;
}

/** A card-shaped skeleton placeholder for list/grid loading. */
export function SkeletonCard({ lines = 2 }: { lines?: number }): React.ReactElement {
  const t = useTheme();
  return (
    <Card style={{ marginBottom: t.spacing.md }}>
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
    <View testID={testID} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing.xxl, gap: t.spacing.md }}>
      <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: t.color.subtle, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={30} color={t.color.textFaint} />
      </View>
      <Text variant="title3" center>
        {title}
      </Text>
      {message ? (
        <Text variant="subhead" color={t.color.textMuted} center>
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: t.spacing.sm, alignSelf: 'stretch' }}>{action}</View> : null}
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
      <Pressable testID={testID} style={{ flex: 1, backgroundColor: t.color.scrim, justifyContent: 'flex-end' }} onPress={onClose}>
        <Animated.View style={{ opacity }}>
          <Pressable onPress={() => undefined}>
            <Animated.View
              style={{
                backgroundColor: t.color.surface,
                borderTopLeftRadius: t.radius.sheet,
                borderTopRightRadius: t.radius.sheet,
                paddingHorizontal: t.spacing.lg,
                paddingTop: t.spacing.md,
                paddingBottom: insets.bottom + t.spacing.lg,
                transform: [{ translateY }],
                ...t.shadow.raised,
              }}
            >
              <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: t.color.hairline, marginBottom: t.spacing.md }} />
              {title ? (
                <Text variant="title3" style={{ marginBottom: t.spacing.sm }}>
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
  const color = tone ? toneColors(t.color, tone).ink : t.color.text;
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      android_ripple={{ color: t.color.surfacePressed }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: MIN_TARGET,
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: t.radius.input,
        backgroundColor: pressed ? t.color.surfacePressed : 'transparent',
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
    <View testID={testID} style={{ flexDirection: 'row', backgroundColor: t.color.subtle, borderRadius: t.radius.input, padding: 3 }}>
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
              ...(active ? { backgroundColor: t.color.surface, ...t.shadow.card } : null),
            }}
          >
            <Text variant="footnote" weight={active ? '700' : '500'} color={active ? t.color.text : t.color.textMuted}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat — KPI tile
// ─────────────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  tone,
  hint,
  testID,
  valueTestID,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
  testID?: string;
  valueTestID?: string;
}): React.ReactElement {
  const t = useTheme();
  const accent = tone ? toneColors(t.color, tone).ink : t.color.text;
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: t.color.surface,
        borderRadius: t.radius.card,
        borderWidth: 1,
        borderColor: t.color.hairline,
        padding: t.spacing.lg,
        ...t.shadow.card,
      }}
    >
      <Text variant="title1" mono tabular color={accent} testID={valueTestID} style={{ fontSize: 30, lineHeight: 34 }}>
        {value}
      </Text>
      <Text variant="footnote" color={t.color.textMuted} style={{ marginTop: 6 }}>
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color={t.color.textFaint} style={{ marginTop: 2 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionHeader / Divider
// ─────────────────────────────────────────────────────────────────────────────

export function SectionHeader({ children, style }: { children: string; style?: StyleProp<TextStyle> }): React.ReactElement {
  const t = useTheme();
  return (
    <Text variant="overline" color={t.color.textFaint} style={[{ marginTop: t.spacing.xl, marginBottom: t.spacing.sm }, style]}>
      {children.toUpperCase()}
    </Text>
  );
}

export function Divider(): React.ReactElement {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.color.hairline, marginVertical: t.spacing.sm }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast — non-blocking inline notice (calm 409 / confirmations)
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ message, tone }: { message: string; tone: Tone }): React.ReactElement {
  const t = useTheme();
  const insets = useInsets();
  const tc = toneColors(t.color, tone);
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
          backgroundColor: t.color.surface,
          borderRadius: t.radius.button,
          borderWidth: 1,
          borderColor: t.color.hairline,
          padding: 14,
          ...t.shadow.raised,
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tc.solid }} />
        <Text variant="subhead" color={t.color.text} style={{ flex: 1 }}>
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

// Re-export the theme hook + tones so screens import everything from one place.
export { useTheme, toneColors };
export type { Theme, Tone };
