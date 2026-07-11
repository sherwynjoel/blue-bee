import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import type { AccountSecurityView, AuthProvider } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../../theme';
import { Button, Card, Input, Text, fireHaptic } from '../../components/ui';

/** Display metadata for each linkable method. Order = display order. */
const METHODS: { provider: AuthProvider; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { provider: 'otp', label: 'Phone', icon: 'phone' },
  { provider: 'password', label: 'Email & password', icon: 'lock' },
  { provider: 'apple', label: 'Apple', icon: 'smartphone' },
  { provider: 'google', label: 'Google', icon: 'chrome' },
];

/**
 * [Inc-35] Profile → "Login & security": the linked sign-in methods + verify state, with set/change
 * password and unlink (the server refuses to unlink the last method). Reads/writes the real
 * `/v1/auth/methods` + `/v1/auth/password` endpoints; degrades gracefully on error.
 */
export function LoginSecuritySection(): React.ReactElement {
  const { client } = useSession();
  const { colors, space } = useTheme();

  const [security, setSecurity] = useState<AccountSecurityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showPw, setShowPw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [unlinking, setUnlinking] = useState<AuthProvider | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setSecurity(await client.getSecurity());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your sign-in methods.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePassword = async (): Promise<void> => {
    setSaving(true);
    setPwError(null);
    setSaved(false);
    try {
      const next = await client.setPassword({
        newPassword: newPw,
        ...(security?.hasPassword && currentPw ? { currentPassword: currentPw } : {}),
      });
      setSecurity(next);
      setShowPw(false);
      setCurrentPw('');
      setNewPw('');
      setSaved(true);
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : 'Could not save your password.');
    } finally {
      setSaving(false);
    }
  };

  const unlink = async (provider: AuthProvider): Promise<void> => {
    setUnlinking(provider);
    setError(null);
    try {
      setSecurity(await client.unlinkMethod(provider));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not unlink that method.');
    } finally {
      setUnlinking(null);
    }
  };

  if (loading) {
    return (
      <Card style={{ marginTop: space.lg }} testID="security-loading">
        <Text variant="headline" weight="700">
          Login &amp; security
        </Text>
        <Text variant="footnote" color="secondary" style={{ marginTop: 8 }}>
          Loading…
        </Text>
      </Card>
    );
  }

  const linked = security?.methods ?? [];
  const canUnlink = linked.length > 1;

  return (
    <Card style={{ marginTop: space.lg }}>
      <Text variant="headline" weight="700">
        Login &amp; security
      </Text>
      <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
        How you sign in. You can use more than one.
      </Text>

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: colors.dangerTint }]}>
          <Text testID="security-error" variant="footnote" color="danger">
            {error}
          </Text>
        </View>
      ) : null}

      <View testID="security-methods" style={{ marginTop: 12 }}>
        {METHODS.map((m) => {
          const isLinked = linked.includes(m.provider);
          return (
            <View key={m.provider} testID={`security-method-${m.provider}`} style={[styles.row, { borderTopColor: colors.hairline }]}>
              <View style={[styles.icon, { backgroundColor: isLinked ? colors.azureTint : colors.subtle }]}>
                <Feather name={m.icon} size={16} color={isLinked ? colors.azure : colors.textTertiary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="subhead" weight="600">
                  {m.label}
                </Text>
                <Text variant="caption" color={isLinked ? 'success' : 'tertiary'}>
                  {isLinked ? (m.provider === 'password' && security && !security.emailVerified ? 'Linked — email not verified' : 'Linked') : 'Not linked'}
                </Text>
              </View>
              {isLinked && canUnlink ? (
                <Button testID={`security-unlink-${m.provider}`} label="Unlink" size="sm" variant="outline" tone="neutral" fullWidth={false} busy={unlinking === m.provider} disabled={unlinking != null} onPress={() => void unlink(m.provider)} haptic="warning" />
              ) : null}
            </View>
          );
        })}
      </View>

      {saved ? (
        <Text testID="security-saved" variant="footnote" color="success" weight="600" style={{ marginTop: 12 }}>
          Password saved.
        </Text>
      ) : null}

      {!showPw ? (
        <Button
          testID="security-set-password"
          label={security?.hasPassword ? 'Change password' : 'Set a password'}
          icon="lock"
          variant="outline"
          onPress={() => {
            fireHaptic('selection');
            setSaved(false);
            setShowPw(true);
          }}
          style={{ marginTop: 14 }}
        />
      ) : (
        <View style={{ marginTop: 14, gap: 12 }}>
          {security?.hasPassword ? (
            <Input testID="security-current-password" label="Current password" icon="lock" value={currentPw} onChangeText={setCurrentPw} secureTextEntry autoCapitalize="none" placeholder="Current password" />
          ) : null}
          <Input testID="security-new-password" label="New password" icon="lock" value={newPw} onChangeText={setNewPw} error={pwError} secureTextEntry autoCapitalize="none" placeholder="At least 8 characters" hint="At least 8 characters." />
          <View style={styles.pwButtons}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="outline" tone="neutral" onPress={() => { setShowPw(false); setPwError(null); }} disabled={saving} haptic="selection" />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="security-save-password" label={saving ? 'Saving…' : 'Save'} busy={saving} disabled={saving || newPw.length < 8} onPress={() => void savePassword()} haptic="medium" />
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  errorBox: { borderRadius: 10, padding: 12, marginTop: 12 },
  pwButtons: { flexDirection: 'row', gap: 12 },
});
