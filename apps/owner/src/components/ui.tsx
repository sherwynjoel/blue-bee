import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/** Shared owner-app UI primitives so every screen renders loading / error / empty the same way. */

export function Loading({ label }: { label?: string }): React.ReactElement {
  return (
    <View style={styles.center} testID="loading">
      <ActivityIndicator size="large" color="#1f6feb" />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <View style={styles.center} testID="error">
      <Text style={styles.error}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity onPress={onRetry} testID="retry">
          <Text style={styles.link}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function EmptyState({ message, testID }: { message: string; testID?: string }): React.ReactElement {
  return (
    <View style={styles.center} testID={testID ?? 'empty'}>
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }): React.ReactElement {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, bold && styles.kvBold]}>{value}</Text>
    </View>
  );
}

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray';

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={[styles.badge, badgeTone[tone]]}>
      <Text style={[styles.badgeText, badgeTextTone[tone]]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  muted: { color: '#57606a', textAlign: 'center' },
  error: { color: '#b91c1c', textAlign: 'center' },
  link: { color: '#1f6feb', fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#eaeef2' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1f2328', marginBottom: 10 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvLabel: { color: '#57606a' },
  kvValue: { color: '#1f2328' },
  kvBold: { fontWeight: '700' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
});

const badgeTone: Record<Tone, object> = {
  green: { backgroundColor: '#dafbe1' },
  amber: { backgroundColor: '#fff8c5' },
  red: { backgroundColor: '#ffebe9' },
  blue: { backgroundColor: '#ddf4ff' },
  gray: { backgroundColor: '#eaeef2' },
};
const badgeTextTone: Record<Tone, object> = {
  green: { color: '#1a7f37' },
  amber: { color: '#9a6700' },
  red: { color: '#cf222e' },
  blue: { color: '#0969da' },
  gray: { color: '#57606a' },
};
