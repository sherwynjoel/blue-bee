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
 * The Blue Bee logomark — an azure squircle cradling a honey bee. The brand's two signature colors in
 * one mark; used on the splash and the login hero ("the bee moment").
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
      <MaterialCommunityIcons name="bee" size={size * 0.58} color={colors.honey} />
    </View>
  );
}
