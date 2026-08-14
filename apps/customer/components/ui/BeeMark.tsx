import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

export interface BeeMarkProps {
  /** Tile size in pt. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Royal logomark — a royal-blue squircle crowned in gold. The brand's two signature colors in one
 * compact mark, used wherever a small brand glyph fits. The full crest (crown + basket) ships as an
 * image asset (assets/brand/royal-logo.png) for the splash, login hero, onboarding and app icon.
 *
 * The component name stays `BeeMark` (it is the app-wide brand-glyph slot, imported in several places
 * and asserted in tests); only what it draws changed — bee → crown — during the Royal rebrand.
 */
export function BeeMark({ size = 72, style }: BeeMarkProps): React.ReactElement {
  const { colors, elevation } = useTheme();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: colors.azure,
          alignItems: 'center',
          justifyContent: 'center',
        },
        elevation.e2,
        style,
      ]}
    >
      <MaterialCommunityIcons name="crown" size={size * 0.54} color={colors.honey} />
    </View>
  );
}
