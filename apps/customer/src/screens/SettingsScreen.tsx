import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../../theme';
import { Button, Card, Text } from '../../components/ui';

/**
 * Settings → account management (PRD §7A). The store-required "Delete account" lives here: a two-step
 * confirm guards the destructive action, then it calls the real `DELETE /v1/account` (server purges PII
 * + anonymizes) and signs the device out. "Sign out" is the non-destructive exit.
 */
export function SettingsScreen(): React.ReactElement {
  const { me, client, logout } = useSession();
  const { colors, space } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirmDelete = async (): Promise<void> => {
    setError(null);
    setDeleting(true);
    try {
      await client.deleteAccount(); // real server-side erasure
      await logout(); // clears tokens + flips the app to signed-out (this screen unmounts)
    } catch (e) {
      // Account NOT deleted server-side — stay signed in and surface the error.
      setError(e instanceof ApiError ? e.message : 'Could not delete your account. Please try again.');
      setDeleting(false);
    }
  };

  const initial = me?.user.name?.trim()?.[0]?.toUpperCase() ?? '?';

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <Card>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: colors.azureTint }]}>
            <Text variant="title2" weight="700" color="azure">
              {initial}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="tertiary">
              SIGNED IN AS
            </Text>
            <Text testID="settings-name" variant="title3" weight="700" style={{ marginTop: 2 }}>
              {me?.user.name ?? '—'}
            </Text>
            {me?.user.phone ? (
              <Text variant="footnote" color="secondary" tabular style={{ marginTop: 2 }}>
                {me.user.phone}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      <Button testID="signout" label="Sign out" icon="log-out" variant="outline" tone="neutral" onPress={() => void logout()} disabled={deleting} style={{ marginTop: space.lg }} haptic="medium" />

      <Card style={[styles.danger, { borderColor: colors.danger }]}>
        <View style={styles.dangerHead}>
          <Feather name="alert-triangle" size={18} color={colors.danger} />
          <Text variant="headline" weight="700" color="danger" style={{ marginLeft: 8 }}>
            Delete account
          </Text>
        </View>
        <Text variant="footnote" color="secondary" style={{ marginTop: 8, lineHeight: 19 }}>
          Permanently deletes your account and personal data (name, phone, devices, notifications). This
          cannot be undone. Past orders are kept as anonymized business records.
        </Text>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.dangerTint }]}>
            <Text testID="delete-error" variant="footnote" color="danger">
              {error}
            </Text>
          </View>
        ) : null}

        {!confirming ? (
          <Button testID="delete-account" label="Delete account" tone="danger" onPress={() => setConfirming(true)} style={{ marginTop: 14 }} haptic="warning" />
        ) : (
          <View testID="delete-confirm" style={{ marginTop: 14, gap: 10 }}>
            <Text variant="subhead" weight="600">
              Are you sure? This is permanent.
            </Text>
            <View style={styles.confirmRow}>
              <View style={{ flex: 1 }}>
                <Button testID="cancel-delete" label="Cancel" variant="outline" tone="neutral" onPress={() => setConfirming(false)} disabled={deleting} haptic="selection" />
              </View>
              <View style={{ flex: 1 }}>
                <Button testID="confirm-delete" label={deleting ? 'Deleting…' : 'Confirm delete'} tone="danger" onPress={() => void onConfirmDelete()} busy={deleting} disabled={deleting} haptic="none" />
              </View>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  identity: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  danger: { marginTop: 24 },
  dangerHead: { flexDirection: 'row', alignItems: 'center' },
  errorBox: { borderRadius: 10, padding: 12, marginTop: 12 },
  confirmRow: { flexDirection: 'row', gap: 12 },
});
