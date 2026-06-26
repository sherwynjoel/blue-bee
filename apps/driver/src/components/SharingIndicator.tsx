import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from './kit';
import { useTheme } from '../theme';

/**
 * The visible "sharing location" indicator (PRD §6.2/US-T5/§12.2) — shown whenever the app is streaming
 * GPS, so the driver always knows their location is being shared. Reassuring, never hidden: a calm green
 * band with a softly pulsing live dot. Rendered only while tracking (returns null otherwise).
 */
export function SharingIndicator({ visible }: { visible: boolean }): React.ReactElement | null {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  if (!visible) return null;

  return (
    <View
      accessibilityRole="alert"
      testID="sharing-indicator"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: t.color.successTint,
        borderBottomWidth: 1,
        borderBottomColor: t.color.hairline,
        paddingVertical: 10,
        paddingHorizontal: 16,
      }}
    >
      <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: t.color.success, opacity: pulse }} />
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.color.success }} />
      </View>
      <Feather name="map-pin" size={15} color={t.color.successInk} />
      <Text variant="footnote" weight="600" color={t.color.successInk} style={{ flexShrink: 1 }}>
        Sharing your location with dispatch &amp; the customer · shift active
      </Text>
    </View>
  );
}
