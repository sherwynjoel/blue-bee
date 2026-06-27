import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Badge as KitBadge, Button, Text } from './kit';
import { useTheme, type Tone as KitTone } from '../theme';

/**
 * Shared owner-app UI primitives so every screen renders loading / error / empty the same way. This is
 * a thin, Daylight-themed compatibility layer over the shared kit — it keeps the original public API
 * (Loading / ErrorBox / EmptyState / Card / Row / Badge + the legacy Tone vocabulary) so screens and
 * tests are untouched, while everything now renders on the operator design system.
 */

export function Loading({ label }: { label?: string }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: t.color.canvas }} testID="loading">
      <ActivityIndicator size="large" color={t.color.azure} />
      {label ? (
        <Text variant="subhead" color={t.color.textMuted} center>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, backgroundColor: t.color.canvas }} testID="error">
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.color.dangerTint, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="alert-triangle" size={28} color={t.color.dangerInk} />
      </View>
      <Text variant="subhead" color={t.color.textMuted} center>
        {message}
      </Text>
      {onRetry ? (
        <View style={{ alignSelf: 'stretch', paddingHorizontal: 24 }}>
          <Button testID="retry" label="Try again" onPress={onRetry} variant="secondary" icon="refresh-cw" fullWidth />
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState({ message, testID }: { message: string; testID?: string }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: t.color.canvas }} testID={testID ?? 'empty'}>
      <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: t.color.successTint, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="check" size={32} color={t.color.successInk} />
      </View>
      <Text variant="title3" center>
        All clear
      </Text>
      <Text variant="subhead" color={t.color.textMuted} center>
        {message}
      </Text>
    </View>
  );
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }): React.ReactElement {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.color.surface,
        borderRadius: t.radius.card,
        padding: t.spacing.lg,
        marginTop: t.spacing.md,
        borderWidth: 1,
        borderColor: t.color.hairline,
        ...t.shadow.card,
      }}
    >
      {title ? (
        <Text variant="headline" style={{ marginBottom: 10 }}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, gap: 12 }}>
      <Text variant="subhead" color={t.color.textMuted}>
        {label}
      </Text>
      <Text variant="subhead" weight={bold ? '700' : '500'} color={t.color.text} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

/** The legacy owner tone vocabulary, mapped onto the Daylight semantic tones. */
export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray';

const TONE_MAP: Record<Tone, KitTone> = {
  green: 'success',
  amber: 'warning',
  red: 'danger',
  blue: 'azure',
  gray: 'neutral',
};

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: React.ReactNode }): React.ReactElement {
  return <KitBadge tone={TONE_MAP[tone]}>{children}</KitBadge>;
}
