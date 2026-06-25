import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * The visible "sharing location" indicator (PRD §6.2/US-T5) — shown whenever the app is streaming
 * GPS, so the driver always knows their location is being shared. Rendered only while tracking.
 */
export function SharingIndicator({ visible }: { visible: boolean }): React.ReactElement | null {
  if (!visible) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert" testID="sharing-indicator">
      <Text style={styles.dot}>●</Text>
      <Text style={styles.text}>Sharing your location with dispatch &amp; the customer (shift active)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b3d2e',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  dot: { color: '#3ddc84', fontSize: 12 },
  text: { color: '#e6f4ee', fontSize: 13, flexShrink: 1 },
});
