import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import type { UpdateProfileInput } from '@blue-bee/shared';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { money } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, Hero, IconBadge, Input, Row, SectionHeader, Sheet, StatTile, Text, fireHaptic } from '../../components/ui';
import type { IconTone } from '../../components/ui';
import { CorporatePricingSection } from '../components/CorporatePricing';
import { LoginSecuritySection } from '../components/LoginSecurity';

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

/**
 * [Inc-33] Profile tab (was Settings) — the customer's account surface (PRD §7A). VIEWS + EDITS the two
 * mutable identity fields (`name`, `email`) via `PATCH /v1/account/profile` (self-only, audited; email
 * unique per org → 409 shown inline), and keeps everything Settings already owned: **phone** read-only
 * (it is the login identity — changing it is Inc-35, not a profile edit), **Addresses** (Inc-26),
 * **Login & security** (Inc-35), **Corporate** join-code pricing, **Sign out**, and the store-required
 * two-step **Delete account** (real `DELETE /v1/account`).
 *
 * [Royal restyle v2 — Profile hub] Rebuilt to match the reference render: a header (title + subtitle +
 * bell/gear), a light-blue identity Hero (brand crest avatar + name + org + email/phone pills + chevron),
 * a colour-coded "My Account" list, and a "Connect With Us" group — all via the shared Row/IconBadge/
 * SectionHeader motif. Below the hub, tapping "Account Info" (or the Hero itself) scrolls to the existing
 * edit-profile card — the app has no separate account-detail ROUTE (adding one would mean touching
 * navigation.ts, which is frozen for this pass), so "wire a real destination" means a real, working
 * in-page target rather than a dead tap.
 *
 * Honesty notes (nothing here is invented):
 *  - Stat strip shows ONLY the two metrics the API actually backs — Total orders (`home.orderCount`) and
 *    Credits (`home.credits.balance`), fetched from GET /v1/home. "Member since" is omitted: the account
 *    payload exposes no created-at, so we show two real stats rather than fabricate a third.
 *  - The "company" line under the name uses `me.org.name` (real, already loaded) when present.
 *  - Preferences / Payment Methods / Subscriptions / Repeat Pickups / Buy Gift Card / Notifications /
 *    Contact Store / Rate Our App have no backing screen or endpoint yet. Each is a REAL, tappable row
 *    (not a fabricated data row) that opens an honest "Coming soon" sheet — no fake counts, prices, or
 *    claims attached to any of them. The header bell/gear reuse the same affordance (Notifications /
 *    Preferences) rather than adding new dead icons. No unread-notification dot is drawn — there's no
 *    real unread-count to back one.
 *  - Addresses (Inc-26) and Account Info (the edit form below) are the two REAL destinations and are
 *    wired accordingly.
 */
export function SettingsScreen(): React.ReactElement {
  const { me, client, logout, reloadMe } = useSession();
  const { colors, space, radius, elevation } = useTheme();
  // Tab header is hidden (every dock tab owns its header) — apply the top safe-area inset here.
  const insets = useSafeAreaInsets();
  // Profile is a TAB screen (no `navigation` prop), so reach the root stack through the hook.
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const scrollRef = useRef<ScrollView>(null);
  const accountInfoY = useRef(0);

  // [Royal] Real account stats for the hero strip — Total orders + Credits, from GET /v1/home (the same
  // live data Home already loads). Member-since is intentionally absent: the account payload exposes no
  // created-at, so we show only the two metrics we can back with real data rather than fabricate a third.
  const [stats, setStats] = useState<{ orderCount: number; balance: string; currency: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const h = await client.getHome();
        if (alive) setStats({ orderCount: h.orderCount, balance: h.credits.balance, currency: h.credits.currency });
      } catch {
        // Show no stats rather than fake ones — the strip simply doesn't render.
      }
    })();
    return () => {
      alive = false;
    };
  }, [client]);

  // ── "Coming soon" — a real, honest affordance for rows with no backend yet. ──
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const openComingSoon = (label: string): void => {
    fireHaptic('selection');
    setComingSoon(label);
  };

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

  // Whatever we actually know about the signed-in identity — never fabricated. The hero reflects live
  // edits immediately (before the round-trip completes) for a responsive feel, same as before the restyle.
  const displayName = (saved || dirty ? trimmedName : currentName) || '—';
  const displayEmail = (saved || dirty ? trimmedEmail : currentEmail) || null;
  const phone = me?.user.phone ?? null;
  const orgName = me?.org?.name ?? null;

  const scrollToAccountInfo = (): void => {
    fireHaptic('selection');
    scrollRef.current?.scrollTo({ y: Math.max(accountInfoY.current - 12, 0), animated: true });
  };

  type AccountItem = {
    key: string;
    title: string;
    subtitle: string;
    icon: FeatherIconName;
    tone: IconTone;
    onPress: () => void;
    testID?: string;
  };

  // ── "My Account" — grouped, colour-coded destinations. Only Account Info + Addresses are real
  // screens today; the rest open the honest "Coming soon" sheet (see file doc). ──
  const accountItems: AccountItem[] = [
    {
      key: 'account-info',
      title: 'Account Info',
      subtitle: 'Manage your personal information',
      icon: 'user',
      tone: 'azure',
      onPress: scrollToAccountInfo,
      testID: 'settings-account-info',
    },
    {
      key: 'preferences',
      title: 'Preferences',
      subtitle: 'Customize your app experience',
      icon: 'sliders',
      tone: 'success',
      onPress: () => openComingSoon('Preferences'),
    },
    {
      key: 'payment-methods',
      title: 'Payment Methods',
      subtitle: 'Manage cards and payment options',
      icon: 'credit-card',
      tone: 'honey',
      onPress: () => openComingSoon('Payment Methods'),
    },
    {
      key: 'subscriptions',
      title: 'Subscriptions',
      subtitle: 'View and manage your plans',
      icon: 'repeat',
      tone: 'warning',
      onPress: () => openComingSoon('Subscriptions'),
    },
    {
      key: 'addresses',
      title: 'Addresses',
      subtitle: 'Manage your saved addresses',
      icon: 'map-pin',
      tone: 'danger',
      onPress: () => navigation.navigate('Addresses'),
      testID: 'settings-addresses',
    },
    {
      key: 'repeat-pickups',
      title: 'Repeat Pickups',
      subtitle: 'Schedule recurring pickups',
      icon: 'calendar',
      tone: 'azure',
      onPress: () => openComingSoon('Repeat Pickups'),
    },
    {
      key: 'gift-card',
      title: 'Buy Gift Card',
      subtitle: 'Purchase gift cards for others',
      icon: 'gift',
      tone: 'danger',
      onPress: () => openComingSoon('Buy Gift Card'),
    },
    {
      key: 'notifications',
      title: 'Notifications',
      subtitle: 'Manage your notification settings',
      icon: 'bell',
      tone: 'honey',
      onPress: () => openComingSoon('Notifications'),
    },
  ];

  const connectItems: AccountItem[] = [
    {
      key: 'contact-store',
      title: 'Contact Store',
      subtitle: 'Get help from our support team',
      icon: 'phone-call',
      tone: 'success',
      onPress: () => openComingSoon('Contact Store'),
    },
    {
      key: 'rate-app',
      title: 'Rate Our App',
      subtitle: 'Tell us what you think',
      icon: 'star',
      tone: 'honey',
      onPress: () => openComingSoon('Rate Our App'),
    },
  ];

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header — title + subtitle, bell/gear (both open the matching Coming-soon affordance). ── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="title1" weight="700">
              Profile
            </Text>
            <Text variant="subhead" color="secondary" style={{ marginTop: 2 }}>
              Manage your account and preferences
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              testID="settings-notifications-icon"
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => openComingSoon('Notifications')}
              hitSlop={6}
              style={[styles.headerIconBtn, elevation.e1, { backgroundColor: colors.surface, borderRadius: radius.input, borderColor: colors.hairline }]}
            >
              <Feather name="bell" size={19} color={colors.text} />
            </Pressable>
            <Pressable
              testID="settings-preferences-icon"
              accessibilityRole="button"
              accessibilityLabel="Preferences"
              onPress={() => openComingSoon('Preferences')}
              hitSlop={6}
              style={[styles.headerIconBtn, elevation.e1, { backgroundColor: colors.surface, borderRadius: radius.input, borderColor: colors.hairline, marginLeft: 10 }]}
            >
              <Feather name="settings" size={19} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* ── Identity hero — brand crest avatar + name + org + email/phone pills + chevron. ── */}
        <Hero testID="settings-hero" style={{ marginTop: space.lg }}>
          <Pressable
            onPress={scrollToAccountInfo}
            accessibilityRole="button"
            accessibilityLabel="View account details"
            style={styles.identityRow}
          >
            <View style={styles.avatarWrap}>
              <View style={[styles.avatar, { backgroundColor: colors.surface }]}>
                <MaterialCommunityIcons name="crown" size={30} color={colors.azure} />
                <View style={[styles.avatarAccent, { backgroundColor: colors.danger }]} />
              </View>
              <View style={[styles.editBadge, { backgroundColor: colors.azure, borderColor: colors.azureTint }]}>
                <Feather name="edit-2" size={11} color={colors.onAzure} />
              </View>
            </View>

            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text testID="settings-name" variant="title2" weight="700" numberOfLines={1}>
                {displayName}
              </Text>
              {orgName ? (
                <Text variant="subhead" color="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
                  {orgName}
                </Text>
              ) : null}
              <View style={styles.pillsRow}>
                {displayEmail ? <IdentityPill icon="mail" label={displayEmail} /> : null}
                {phone ? <IdentityPill icon="phone" label={formatPhonePill(phone)} /> : null}
              </View>
            </View>

            <Feather name="chevron-right" size={20} color={colors.textTertiary} />
          </Pressable>
        </Hero>

        {/* ── Stat strip — REAL metrics only (Total orders + Credits from GET /v1/home). ── */}
        {stats ? (
          <Card testID="settings-stats" style={{ marginTop: space.md }}>
            <View style={styles.statStrip}>
              <View style={styles.statCell}>
                <StatTile icon="package" tone="azure" card={false} value={String(stats.orderCount)} label="Total orders" />
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.hairline }]} />
              <View style={styles.statCell}>
                <StatTile icon="gift" tone="success" card={false} value={money(stats.balance, stats.currency)} label="Credits" emphasize />
              </View>
            </View>
          </Card>
        ) : null}

        {/* ── My Account — the colour-coded grouped menu. ── */}
        <SectionHeader title="My Account" style={{ marginTop: space.xxl, marginBottom: 10 }} />
        <Card padding={0} testID="account-menu">
          {accountItems.map((item, idx) => (
            <View
              key={item.key}
              style={idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline } : undefined}
            >
              <Row
                testID={item.testID}
                title={item.title}
                subtitle={item.subtitle}
                icon={item.icon}
                iconTone={item.tone}
                onPress={item.onPress}
              />
            </View>
          ))}
        </Card>

        {/* ── Connect With Us. ── */}
        <SectionHeader title="Connect With Us" style={{ marginTop: space.xxl, marginBottom: 10 }} />
        <Card padding={0} testID="connect-menu">
          {connectItems.map((item, idx) => (
            <View
              key={item.key}
              style={idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline } : undefined}
            >
              <Row
                testID={item.testID}
                title={item.title}
                subtitle={item.subtitle}
                icon={item.icon}
                iconTone={item.tone}
                onPress={item.onPress}
              />
            </View>
          ))}
        </Card>

        {/* [Inc-33] Account Info — the real edit-profile destination the Hero/menu row scrolls to. */}
        <View
          onLayout={(e) => {
            accountInfoY.current = e.nativeEvent.layout.y;
          }}
        >
          <SectionHeader title="Account Info" style={{ marginTop: space.xxl, marginBottom: 10 }} />
          <Card>
            <View style={styles.detailsHead}>
              <IconBadge icon="user" tone="azure" size={40} circle />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text variant="headline" weight="700">
                  Your details
                </Text>
                <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
                  View and update your personal information
                </Text>
              </View>
            </View>

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
              containerStyle={{ marginTop: space.lg }}
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
                  {phone ?? '—'}
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
        </View>

        {/* Sign out — its own row, the icon-in-circle grouped-row motif. */}
        <Card padding={0} style={{ marginTop: space.lg }}>
          <Row testID="signout" title="Sign out" icon="log-out" iconTone="neutral" chevron={false} onPress={onSignOut} haptic="medium" />
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

      {/* Honest "Coming soon" — a real, working affordance for rows/icons with no backend yet. */}
      <Sheet visible={comingSoon != null} onClose={() => setComingSoon(null)} title={comingSoon ?? undefined} testID="coming-soon-sheet">
        <Text variant="body" color="secondary" style={{ marginBottom: 20, lineHeight: 22 }}>
          We’re building this — check back soon.
        </Text>
        <Button label="Got it" onPress={() => setComingSoon(null)} haptic="selection" />
      </Sheet>
    </>
  );
}

/**
 * Cosmetic formatting only (+1XXXXXXXXXX → +1 (XXX) XXX-XXXX) for the Hero pill — the Account Info
 * card below still shows the raw stored value untouched. Falls back to the raw string for any shape
 * that isn't a 10-digit NANP number, so nothing is ever mangled or invented.
 */
function formatPhonePill(raw: string): string {
  const m = raw.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : raw;
}

/** A small pill — icon + a line of identity text (email/phone). Local to this screen. */
function IdentityPill({ icon, label }: { icon: FeatherIconName; label: string }): React.ReactElement {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors.surface, borderRadius: radius.pill }]}>
      <Feather name={icon} size={12} color={colors.azure} />
      <Text variant="caption" weight="600" numberOfLines={1} style={{ marginLeft: 5 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerIconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },

  identityRow: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  avatarAccent: { position: 'absolute', bottom: 10, width: 22, height: 3, borderRadius: 2, opacity: 0.55 },
  editBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, maxWidth: 190 },

  statStrip: { flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1, alignItems: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 40 },

  detailsHead: { flexDirection: 'row', alignItems: 'center' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  danger: { marginTop: 24 },
  dangerHead: { flexDirection: 'row', alignItems: 'center' },
  errorBox: { borderRadius: 10, padding: 12, marginTop: 12 },
  confirmRow: { flexDirection: 'row', gap: 12 },
});
