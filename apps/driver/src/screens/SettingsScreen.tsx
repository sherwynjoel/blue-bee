import React, { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';
import { Button, Card, Text, useTheme } from '@blue-bee/ui';
import { Screen } from '../components/kit';

/**
 * Settings → account management. The store-required "Delete account" lives here: a two-step confirm
 * guards the destructive action, then it calls the real `DELETE /v1/account` (server purges PII +
 * anonymizes) and signs the device out. "Sign out" is the non-destructive exit.
 */
export function SettingsScreen(): React.ReactElement {
  const t = useTheme();
  const { me, client, logout } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirmDelete = async (): Promise<void> => {
    setError(null);
    setDeleting(true);
    try {
      await client.deleteAccount();
      await logout();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete your account. Please try again.');
      setDeleting(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Text variant="footnote" color={t.colors.textSecondary}>
          Signed in as
        </Text>
        <Text testID="settings-name" variant="title3" style={{ marginTop: 4 }}>
          {me?.user.name ?? '—'}
        </Text>
        {me?.user.phone ? (
          <Text variant="subhead" color={t.colors.textSecondary} mono style={{ marginTop: 2 }}>
            {me.user.phone}
          </Text>
        ) : null}
      </Card>

      <View style={{ height: t.space.lg }} />
      <Button testID="signout" label="Sign out" onPress={() => void logout()} disabled={deleting} tone="neutral" variant="outline" size="md" icon="log-out" fullWidth />

      <View style={{ height: t.space.xl }} />
      <Card style={{ borderColor: t.colors.dangerTint, backgroundColor: t.colors.dangerTint }}>
        <Text variant="headline" color={t.colors.onDangerTint}>
          Delete account
        </Text>
        <Text variant="footnote" color={t.colors.textSecondary} style={{ marginTop: 8, lineHeight: 20 }}>
          Permanently deletes your account and personal data (name, phone, devices, notifications, and your
          driver licence on file). This cannot be undone. Completed-shift records are kept as anonymized
          operational records.
        </Text>

        {error ? (
          <Text testID="delete-error" variant="subhead" color={t.colors.onDangerTint} style={{ marginTop: 12 }}>
            {error}
          </Text>
        ) : null}

        {!confirming ? (
          <Button testID="delete-account" label="Delete account" onPress={() => setConfirming(true)} tone="danger" size="md" icon="trash-2" fullWidth style={{ marginTop: 14 }} />
        ) : (
          <View testID="delete-confirm" style={{ marginTop: 14, gap: 12 }}>
            <Text variant="subhead" weight="600">
              Are you sure? This is permanent.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Button testID="cancel-delete" label="Cancel" onPress={() => setConfirming(false)} disabled={deleting} tone="neutral" variant="outline" size="md" fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button testID="confirm-delete" label="Confirm delete" onPress={() => void onConfirmDelete()} busy={deleting} disabled={deleting} tone="danger" size="md" haptic="warning" fullWidth />
              </View>
            </View>
          </View>
        )}
      </Card>
    </Screen>
  );
}
