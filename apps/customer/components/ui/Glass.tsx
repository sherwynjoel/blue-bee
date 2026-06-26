import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../theme';

export interface GlassProps {
  children: React.ReactNode;
  /** Blur strength (0–100). */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  /** Rounded corners (defaults to the card radius). */
  radius?: number;
  testID?: string;
}

/**
 * A frosted-glass surface (expo-blur) with a theme-tinted translucent fill that doubles as the
 * graceful fallback when platform blur is unavailable. Used for the hero track ETA card, sticky
 * action bars, and translucent chrome — the Daylight "premium glass" moment.
 */
export function Glass({ children, intensity = 24, style, radius, testID }: GlassProps): React.ReactElement {
  const { colors, radius: r } = useTheme();
  const cornerRadius = radius ?? r.card;
  // Android's BlurView support is uneven; lean on the translucent fill there for a reliable result.
  const blurIntensity = Platform.OS === 'android' ? Math.min(intensity, 16) : intensity;

  return (
    <View testID={testID} style={[{ borderRadius: cornerRadius, overflow: 'hidden' }, style]}>
      <BlurView
        intensity={blurIntensity}
        tint={colors.blurTint}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.glass }]}
      />
      <View style={[styles.border, { borderColor: colors.hairline, borderRadius: cornerRadius }]} pointerEvents="none" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  border: { ...StyleSheet.absoluteFillObject, borderWidth: StyleSheet.hairlineWidth },
});
