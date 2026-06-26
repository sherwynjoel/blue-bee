import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: React.ComponentProps<typeof Feather>['name'];
  /** Tone for the icon halo (default azure). */
  tone?: 'azure' | 'honey' | 'neutral';
  testID?: string;
}

/** A designed empty/zero state — haloed icon, title, supporting copy, optional primary CTA. */
export function EmptyState({
  icon = 'inbox',
  title,
  body,
  actionLabel,
  onAction,
  actionIcon,
  tone = 'azure',
  testID,
}: EmptyStateProps): React.ReactElement {
  const { colors, space } = useTheme();
  const haloBg = tone === 'honey' ? colors.honeyTint : tone === 'neutral' ? colors.subtle : colors.azureTint;
  const haloFg = tone === 'honey' ? colors.honey : tone === 'neutral' ? colors.textSecondary : colors.azure;

  return (
    <View testID={testID} style={styles.wrap}>
      <View style={[styles.halo, { backgroundColor: haloBg }]}>
        <Feather name={icon} size={30} color={haloFg} />
      </View>
      <Text variant="title3" weight="600" center style={{ marginTop: space.xl }}>
        {title}
      </Text>
      {body ? (
        <Text variant="subhead" color="secondary" center style={{ marginTop: space.sm, maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} icon={actionIcon} onPress={onAction} fullWidth={false} style={{ marginTop: space.xxl, paddingHorizontal: 28 }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48 },
  halo: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
