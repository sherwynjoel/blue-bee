import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

export interface HeroProps {
  children: React.ReactNode;
  /** Inner padding (default 20). */
  padding?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A soft brand "hero band" — the eye-catching gradient panel from the reference (Home greeting,
 * tracking header, referral promo). We have no gradient native module (keeping the dev client intact),
 * so the wash is faked with a tinted base plus two translucent decorative blobs that give depth without
 * a hard edge. Purely decorative rgba layers; content sits above on a transparent stack.
 */
export function Hero({ children, padding = 20, style, testID }: HeroProps): React.ReactElement {
  const { colors, radius } = useTheme();
  return (
    <View
      testID={testID}
      style={[styles.wrap, { backgroundColor: colors.azureTint, borderRadius: radius.card, padding }, style]}
    >
      {/* decorative depth — a royal-blue glow bottom-left and a lavender glow top-right */}
      <View pointerEvents="none" style={[styles.blob, styles.blobA]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobB]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  content: { position: 'relative' },
  blob: { position: 'absolute', borderRadius: 999 },
  blobA: { width: 220, height: 220, right: -70, top: -90, backgroundColor: 'rgba(139,124,246,0.16)' },
  blobB: { width: 180, height: 180, left: -60, bottom: -80, backgroundColor: 'rgba(30,80,200,0.10)' },
});
