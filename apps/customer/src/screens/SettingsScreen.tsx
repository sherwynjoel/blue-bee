import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import type { UpdateProfileInput } from '@blue-bee/shared';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../../theme';
import { Button, Card, Input, Text, fireHaptic } from '../../components/ui';
import { CorporatePricingSection } from '../components/CorporatePricing';
import { LoginSecuritySection } from '../components/LoginSecurity';

/**
 * [Inc-33] Profile tab (was Settings) — the customer's account surface (PRD §7A). It now VIEWS + EDITS
 * the two mutable identity fields (`name`, `email`) via `PATCH /v1/account/profile` (self-only, audited;
 * email unique per org → 409 shown inline), and keeps everything Settings already owned: **phone**
 * read-only (it is the login identity — changing it is Inc-35, not a profile edit), **Addresses**
 * (Inc-26), **Corporate** join-code pricing, **Sign out**, and the store-required two-step **Delete
 * account** (real `DELETE /v1/account`). No placeholder login-methods section yet — Inc-35 adds the
 * others. An edit here reflects in the console customer-360 (Inc-27), which reads the same `User` row.
 */
export function SettingsScreen(): React.ReactElement {
  const { me, client, logout, reloadMe } = useSession();
  const { colors, space } = useTheme();
  // Profile is a TAB screen (no `navigation` prop), so reach the root stack through the hook.
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  // ── delete-account flow (unchanged) ──
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── edit-profile flow (Inc-33) ── inputs seed from the current identity; the server normalizes email.
  const currentName = me?.user.name ?? '';
  const currentEmail = me?.user.email ?? '';
  const [name, setName] = useState(currentName);
  const [email, setEmail] = useState(currentEmail);
  const [saving, setSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  // Dirty ⇔ a field differs from the live identity. Empty email is a valid "clear"; empty name is not.
  const dirty = trimmedName !== currentName || trimmedEmail !== currentEmail;
  const canSave = dirty && trimmedName.length > 0 && !saving;

  const onSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setEmailError(null);
    setFormError(null);
    setSaved(false);

    // Send only what changed (PATCH). An empty email is an explicit clear.
    const payload: UpdateProfileInput = {};
    if (trimmedName !== currentName) payload.name = trimmedName;
    if (trimmedEmail !== currentEmail) payload.email = trimmedEmail;

    try {
      const updated = await client.updateProfile(payload);
      // Reflect the SERVER's normalized values (email lower-cased), then refresh /me so the rest of the
      // app (greeting, avatar, console parity) sees the change too.
      setName(updated.name);
      setEmail(updated.email ?? '');
      setSaved(true);
      await reloadMe();
    } catch (e) {
      // The only 409 this endpoint returns is a taken email — surface it inline on the field.
      if (e instanceof ApiError && (e.isConflict || e.code === 'email_taken')) {
        setEmailError('That email is already in use.');
      } else {
        setFormError(e instanceof ApiError ? e.message : 'Could not save your profile. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

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

  const initial = (saved || dirty ? trimmedName : currentName)?.[0]?.toUpperCase() ?? '?';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
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
            {/* Phone shows once, read-only, in the "Your details" card below (it is the login identity). */}
          </View>
        </View>
      </Card>

      {/* [Inc-33] Edit name + email. Phone is read-only (login identity). */}
      <Card style={{ marginTop: space.lg }}>
        <Text variant="headline" weight="700">
          Your details
        </Text>

        <Input
          testID="profile-name-input"
          label="Name"
          icon="user"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setSaved(false);
            setFormError(null);
          }}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="Your name"
          returnKeyType="next"
          containerStyle={{ marginTop: space.md }}
        />

        <Input
          testID="profile-email-input"
          label="Email"
          icon="mail"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setEmailError(null);
            setSaved(false);
            setFormError(null);
          }}
          error={emailError}
          hint="Optional — for receipts and updates."
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
          containerStyle={{ marginTop: space.md }}
        />

        {/* Phone — read-only; this is the login identity (Inc-35 adds other methods). */}
        <View style={[styles.phoneRow, { borderTopColor: colors.hairline }]}>
          <Feather name="phone" size={16} color={colors.textTertiary} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text variant="subhead" weight="600" tabular>
              {me?.user.phone ?? '—'}
            </Text>
            <Text variant="caption" color="tertiary" style={{ marginTop: 1 }}>
              This is your login
            </Text>
          </View>
          <Feather name="lock" size={15} color={colors.textTertiary} />
        </View>

        {formError ? (
          <View style={[styles.errorBox, { backgroundColor: colors.dangerTint }]}>
            <Text testID="profile-error" variant="footnote" color="danger">
              {formError}
            </Text>
          </View>
        ) : null}

        {saved ? (
          <Text testID="profile-saved" variant="footnote" color="success" weight="600" style={{ marginTop: 12 }}>
            Profile updated.
          </Text>
        ) : null}

        <Button
          testID="profile-save"
          label={saving ? 'Saving…' : 'Save changes'}
          icon="check"
          onPress={() => void onSave()}
          busy={saving}
          disabled={!canSave}
          style={{ marginTop: 14 }}
          haptic="medium"
        />
      </Card>

      {/* [Inc-35] Login & security — linked sign-in methods + set/change password + unlink. */}
      <LoginSecuritySection />

      {/* [Inc-26] Saved addresses — add / edit / set default / remove. */}
      <Card style={{ marginTop: space.lg }}>
        <Pressable
          testID="settings-addresses"
          onPress={() => {
            fireHaptic('selection');
            navigation.navigate('Addresses');
          }}
          style={styles.navRow}
          accessibilityRole="button"
        >
          <View style={[styles.navIcon, { backgroundColor: colors.azureTint }]}>
            <Feather name="map-pin" size={17} color={colors.azure} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text variant="subhead" weight="600">
              Addresses
            </Text>
            <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
              Where we collect and deliver.
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
      </Card>

      <Button testID="signout" label="Sign out" icon="log-out" variant="outline" tone="neutral" onPress={() => void logout()} disabled={deleting} style={{ marginTop: space.lg }} haptic="medium" />

      <CorporatePricingSection />

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  identity: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  navRow: { flexDirection: 'row', alignItems: 'center' },
  navIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  danger: { marginTop: 24 },
  dangerHead: { flexDirection: 'row', alignItems: 'center' },
  errorBox: { borderRadius: 10, padding: 12, marginTop: 12 },
  confirmRow: { flexDirection: 'row', gap: 12 },
});
