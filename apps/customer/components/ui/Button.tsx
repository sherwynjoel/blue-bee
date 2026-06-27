import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, usePressScale } from '../../theme';
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
  /** Haptic to fire on press (default 'light'). */
  haptic?: HapticKind;
  fullWidth?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SIZE: Record<ButtonSize, { minHeight: number; paddingH: number; gap: number; icon: number }> = {
  lg: { minHeight: 54, paddingH: 20, gap: 8, icon: 19 },
  md: { minHeight: 46, paddingH: 16, gap: 7, icon: 17 },
  sm: { minHeight: 36, paddingH: 12, gap: 6, icon: 15 },
};

/**
 * The Daylight primary control. Spring press-scale (reduced-motion aware) + a light impact haptic on
 * press; solid / outline / ghost across azure / success / danger / neutral tones; busy + disabled
 * states. Always ≥44pt tall (touch-target a11y). Forwards `testID` so existing tests keep matching.
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
  haptic = 'light',
  fullWidth = true,
  testID,
  style,
}: ButtonProps): React.ReactElement {
  const { colors, radius } = useTheme();
  const press = usePressScale(!disabled && !busy);
  const dims = SIZE[size];
  const isDisabled = disabled || busy;

  const toneColor =
    tone === 'azure' ? colors.azure : tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.text;

  let bg = 'transparent';
  let fg = toneColor;
  let borderColor = 'transparent';
  let borderWidth = 0;

  if (variant === 'solid') {
    bg = tone === 'neutral' ? colors.subtle : toneColor;
    fg = tone === 'neutral' ? colors.text : tone === 'azure' ? colors.onAzure : '#FFFFFF';
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
