import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, usePressScale } from './theme';
import { Text } from './Text';
import { fireHaptic, type HapticKind } from './haptics';

export type ButtonTone = 'azure' | 'success' | 'danger' | 'neutral';
export type ButtonVariant = 'solid' | 'outline' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  tone?: ButtonTone;
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  disabled?: boolean;
  /** A Feather icon name rendered before the label. */
  icon?: React.ComponentProps<typeof Feather>['name'];
  /** A Feather icon name rendered after the label (driver/owner's capability — preserved here). */
  iconRight?: React.ComponentProps<typeof Feather>['name'];
  haptic?: HapticKind;
  fullWidth?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SIZE: Record<ButtonSize, { minHeight: number; paddingH: number; gap: number; icon: number }> = {
  lg: { minHeight: 54, paddingH: 20, gap: 8, icon: 19 },
  md: { minHeight: 46, paddingH: 16, gap: 7, icon: 17 },
  // sm stays visually compact via type/padding but never dips under the 44pt platform minimum target.
  sm: { minHeight: 44, paddingH: 12, gap: 6, icon: 15 },
};

/**
 * The shared Daylight button — reconciles customer's orthogonal tone×variant API with driver/owner's
 * iconRight support (see docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md's
 * Component API Reconciliation section for why). Spring press-scale + haptic on press; solid/outline/
 * ghost across azure/success/danger/neutral tones; busy + disabled states; ≥44pt tall.
 *
 * Defaults `fullWidth`/`haptic` are customer's (`true` / `'light'`) — verified by call-site count as the
 * majority-omittable defaults across all three apps (see packages/ui task-2 report).
 */
export function Button({
  label,
  onPress,
  tone = 'azure',
  variant = 'solid',
  size = 'lg',
  busy = false,
  disabled = false,
  icon,
  iconRight,
  haptic = 'light',
  fullWidth = true,
  testID,
  style,
}: ButtonProps): React.ReactElement {
  const { colors, radius } = useTheme();
  const press = usePressScale(!disabled && !busy);
  const dims = SIZE[size];
  const isDisabled = disabled || busy;

  // The AA-safe full-strength hue for the current scheme — deep in light, bright in dark. Used for
  // outline/ghost LABELS as well as solid fills: `success`/`danger` proper are mark colours, and
  // `danger` as a label on surface is 3.91:1 (the outline "Decline" button shipped that way).
  const toneColor =
    tone === 'azure'
      ? colors.azure
      : tone === 'success'
        ? colors.successSolid
        : tone === 'danger'
          ? colors.dangerSolid
          : colors.text;

  let bg = 'transparent';
  let fg = toneColor;
  let borderColor = 'transparent';
  let borderWidth = 0;

  if (variant === 'solid') {
    // A filled button needs the tone's SOLID pair, not its mark colour: the bright `success`/`danger`
    // values are tuned for dots and borders and fail AA under a label (white on light `danger` is
    // 3.91:1). `successSolid`/`dangerSolid` + their `on*` inks hold 4.5:1 in both schemes.
    const solid =
      tone === 'azure'
        ? { bg: colors.azure, fg: colors.onAzure }
        : tone === 'success'
          ? { bg: colors.successSolid, fg: colors.onSuccess }
          : tone === 'danger'
            ? { bg: colors.dangerSolid, fg: colors.onDanger }
            : { bg: colors.subtle, fg: colors.text };
    bg = solid.bg;
    fg = solid.fg;
    if (tone === 'neutral') {
      borderColor = colors.hairline;
      borderWidth = StyleSheet.hairlineWidth;
    }
  } else if (variant === 'outline') {
    bg = colors.surface;
    fg = toneColor;
    borderColor = tone === 'neutral' ? colors.hairline : toneColor;
    borderWidth = 1.5;
  }

  const handlePress = (): void => {
    if (isDisabled) return;
    fireHaptic(haptic);
    onPress?.();
  };

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      accessibilityLabel={label}
      style={fullWidth ? undefined : styles.inlineWrap}
    >
      <Animated.View
        style={[
          styles.base,
          {
            minHeight: dims.minHeight,
            paddingHorizontal: dims.paddingH,
            gap: dims.gap,
            backgroundColor: bg,
            borderColor,
            borderWidth,
            borderRadius: radius.button,
            opacity: isDisabled ? 0.4 : 1,
            transform: press.transform,
          },
          style,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.content}>
            {icon ? <Feather name={icon} size={dims.icon} color={fg} style={{ marginRight: dims.gap }} /> : null}
            <Text variant={size === 'sm' ? 'subhead' : 'headline'} weight="600" style={{ color: fg }}>
              {label}
            </Text>
            {iconRight ? <Feather name={iconRight} size={dims.icon} color={fg} style={{ marginLeft: dims.gap }} /> : null}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  inlineWrap: { alignSelf: 'flex-start' },
});
