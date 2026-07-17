import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import type { UpdateProfileInput } from '@blue-bee/shared';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../../theme';
import { Button, Card, Hero, IconBadge, Input, Row, SectionHeader, Text } from '../../components/ui';
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
 *
 * [Royal restyle] Gradient identity Hero (avatar initial + name + email/phone) up top, then a grouped
 * colour-coded menu (Row + IconBadge) for the simple destinations. No "member since" / stat row: this
 * screen's data (`me.user`) carries no numeric fields to show honestly — a credit balance lives on Home,
 * not here, and nothing is invented to fill the space. A "Support" entry was in the reference brief, but
 * the app has no real support channel wired up yet (no contact address, no screen, no nav target) — adding
 * one here would mean fabricating a destination, so it's intentionally omitted pending that feature.
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

  const onSignOut = (): void => {
    if (deleting) return; // don't let a stray tap race the delete-account call in flight
    void logout();
  };

  const initial = (saved || dirty ? trimmedName : currentName)?.[0]?.toUpperCase() ?? '?';
  // Whatever we actually know about the signed-in identity beyond the name — never fabricated.
  const identityMeta = (saved || dirty ? trimmedEmail : currentEmail) || me?.user.phone || null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* ── Identity hero — avatar initial + name + email/phone. ── */}
      <Hero testID="settings-hero">
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: colors.surface }]}>
            <Text variant="title2" weight="700" color="azure">
              {initial}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text testID="settings-name" variant="title2" weight="700" numberOfLines={1}>
              {me?.user.name ?? '—'}
            </Text>
            {identityMeta ? (
              <Text variant="subhead" color="secondary" style={{ marginTop: 2 }} numberOfLines={1}>
                {identityMeta}
              </Text>
            ) : null}
          </View>
        </View>
      </Hero>

      {/* [Inc-33] Personal details — edit name + email inline. Phone is read-only (login identity). */}
      <SectionHeader title="Personal details" style={{ marginTop: space.xxl, marginBottom: 10 }} />
      <Card>
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
          <IconBadge icon="phone" tone="neutral" size={34} />
          <View style={{ flex: 1, marginLeft: 12 }}>
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

      {/* ── Account menu — saved addresses + sign out, the icon-in-circle grouped-row motif. ── */}
      <SectionHeader title="Account" style={{ marginTop: space.lg, marginBottom: 10 }} />
      <Card padding={0}>
        {/* [Inc-26] Saved addresses — add / edit / set default / remove. */}
        <Row
          testID="settings-addresses"
          title="Saved addresses"
          subtitle="Where we collect and deliver."
          icon="map-pin"
          iconTone="azure"
          onPress={() => navigation.navigate('Addresses')}
        />
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }}>
          <Row testID="signout" title="Sign out" icon="log-out" iconTone="neutral" chevron={false} onPress={onSignOut} haptic="medium" />
        </View>
      </Card>

      <CorporatePricingSection />

      {/* Delete account — a real, permanent, two-step DELETE /v1/account. */}
      <Card style={[styles.danger, { borderColor: colors.danger }]}>
        <View style={styles.dangerHead}>
          <IconBadge icon="alert-triangle" tone="danger" size={36} />
          <Text variant="headline" weight="700" color="danger" style={{ marginLeft: 12 }}>
            Delete account
          </Text>
        </View>
        <Text variant="footnote" color="secondary" style={{ marginTop: 10, lineHeight: 19 }}>
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
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  danger: { marginTop: 24 },
  dangerHead: { flexDirection: 'row', alignItems: 'center' },
  errorBox: { borderRadius: 10, padding: 12, marginTop: 12 },
  confirmRow: { flexDirection: 'row', gap: 12 },
});
