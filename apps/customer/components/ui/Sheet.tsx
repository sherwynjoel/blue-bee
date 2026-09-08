import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from '@blue-bee/ui';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  testID?: string;
}

/** A bottom sheet — scrim + a surface with a 24pt top radius and a grab handle. Dismiss by tapping the scrim. */
export function Sheet({ visible, onClose, title, children, testID }: SheetProps): React.ReactElement {
  const { colors, radius, elevation, space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={onClose} accessibilityLabel="Close" />
      <View
        testID={testID}
        style={[
          styles.sheet,
          elevation.sheet,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingBottom: Math.max(insets.bottom, space.lg) + space.sm,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.hairline }]} />
        {title ? (
          <Text variant="title3" weight="600" style={{ marginBottom: space.md }}>
            {title}
          </Text>
        ) : null}
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10 },
  handle: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 16 },
});
