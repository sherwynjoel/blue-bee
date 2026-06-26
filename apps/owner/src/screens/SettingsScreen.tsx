import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';

/**
 * Settings → account management. The store-required "Delete account" lives here: a two-step confirm
 * guards the destructive action, then it calls the real `DELETE /v1/account` (server purges PII +
 * anonymizes) and signs the device out. "Sign out" is the non-destructive exit.
 */
export function SettingsScreen(): React.ReactElement {
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
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text testID="settings-name" style={styles.value}>{me?.user.name ?? '—'}</Text>
        {me?.user.phone ? <Text style={styles.muted}>{me.user.phone}</Text> : null}
      </View>

      <TouchableOpacity testID="signout" style={styles.signout} onPress={() => void logout()} disabled={deleting}>
        <Text style={styles.signoutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={styles.danger}>
        <Text style={styles.dangerTitle}>Delete account</Text>
        <Text style={styles.dangerBody}>
          Permanently deletes your account and personal data (name, phone, devices, notifications). This
          cannot be undone. Business records are kept as anonymized records.
        </Text>

        {error ? <Text testID="delete-error" style={styles.error}>{error}</Text> : null}

        {!confirming ? (
          <TouchableOpacity testID="delete-account" style={styles.deleteBtn} onPress={() => setConfirming(true)}>
            <Text style={styles.deleteBtnText}>Delete account</Text>
          </TouchableOpacity>
        ) : (
          <View testID="delete-confirm" style={styles.confirmRow}>
            <Text style={styles.confirmText}>Are you sure? This is permanent.</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity testID="cancel-delete" style={styles.cancelBtn} onPress={() => setConfirming(false)} disabled={deleting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="confirm-delete" style={styles.deleteBtn} onPress={() => void onConfirmDelete()} disabled={deleting}>
                <Text style={styles.deleteBtnText}>{deleting ? 'Deleting…' : 'Confirm delete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa', padding: 16, gap: 16 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 16, borderWidth: 1, borderColor: '#eaeef2' },
  label: { color: '#57606a', fontSize: 13 },
  value: { fontSize: 18, fontWeight: '700', color: '#1f2328', marginTop: 4 },
  muted: { color: '#57606a', marginTop: 4 },
  signout: { padding: 14, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#d0d7de' },
  signoutText: { color: '#1f2328', fontWeight: '600', fontSize: 15 },
  danger: { backgroundColor: '#fff', borderRadius: 10, padding: 16, borderWidth: 1, borderColor: '#ffccc7' },
  dangerTitle: { fontSize: 16, fontWeight: '700', color: '#b91c1c' },
  dangerBody: { color: '#57606a', marginTop: 8, lineHeight: 20 },
  error: { color: '#b91c1c', marginTop: 12 },
  deleteBtn: { backgroundColor: '#b91c1c', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  deleteBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  confirmRow: { marginTop: 12, gap: 12 },
  confirmText: { color: '#1f2328', fontWeight: '600' },
  confirmButtons: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#d0d7de' },
  cancelText: { color: '#1f2328', fontWeight: '600' },
});
