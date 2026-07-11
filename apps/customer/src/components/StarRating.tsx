import React from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';

/**
 * [Inc-32] A 1–5 star row. Interactive when `onChange` is given (the Rate screen); read-only otherwise
 * (the submitted score on OrderDetail / the order card). Selected stars use the honey accent; unselected
 * are a muted outline — no invented half-stars, a rating is a whole 1–5.
 */
export function StarRating({
  value,
  onChange,
  size = 22,
  testID,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} testID={testID} accessibilityRole={onChange ? 'radiogroup' : 'image'} accessibilityLabel={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const icon = <Feather name="star" size={size} color={filled ? colors.honey : colors.textTertiary} style={filled ? undefined : { opacity: 0.45 }} />;
        return onChange ? (
          <Pressable key={n} testID={`star-${n}`} onPress={() => onChange(n)} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`} hitSlop={6}>
            {icon}
          </Pressable>
        ) : (
          <View key={n}>{icon}</View>
        );
      })}
    </View>
  );
}
