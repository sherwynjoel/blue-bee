import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@blue-bee/api-client';
import type { OAuthProvider } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { getProviderIdToken, OAuthUnavailableError } from '../auth/oauth-native';
import { useTheme } from '../../theme';
import { Card, Hero, Button, Input, Text } from '../../components/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires -- static asset require, matches App.tsx/OnboardingScreen.tsx
const ROYAL_LOGO = require('../../assets/brand/royal-logo.png');

type Mode = 'phone' | 'code' | 'email' | 'register' | 'forgot';

/**
 * [Inc-35] Sign in — phone-OTP (the existing primary path) PLUS email+password (with "create account" +
 * "forgot password") and Continue-with-Apple / Continue-with-Google. All methods resolve to ONE account
 * server-side (dedupe by verified email). The provider token is verified SERVER-SIDE; the on-device
 * acquisition is wired in the EAS build (see `getProviderIdToken`). A `?ref=` deep link prefills the
 * signup referral code. No reward is implied anywhere (referral reward is deferred — Inc-34).
 *
 * [Royal restyle] The Blue Bee mark + wordmark are replaced by the Royal crest (crown + basket + "ROYAL
 * DRY CLEANING & LAUNDRY" lockup) inside the same soft Hero band used on Dashboard, and every auth form
 * now sits on an elevated Card — same primitives, same calls, same testIDs.
 */
export function LoginScreen(): React.ReactElement {
  const { requestOtp, login, client, completeSignIn } = useSession();
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // A `?ref=CODE` deep link prefills the signup referral code (invite path). Best-effort.
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const m = url ? /[?&]ref=([^&]+)/.exec(url) : null;
      if (m?.[1]) setReferralCode(decodeURIComponent(m[1]));
    });
  }, []);

  const reset = (): void => {
    setError(null);
    setInfo(null);
  };
  const go = (m: Mode): void => {
    reset();
    setMode(m);
  };
  const fail = (e: unknown, fallback: string): void => setError(e instanceof ApiError ? e.message : fallback);

  async function sendCode(): Promise<void> {
    setBusy(true);
    reset();
    try {
      const { devCode: dc } = await requestOtp(phone.trim());
      setDevCode(dc);
      if (dc) setCode(dc);
      setMode('code');
    } catch (e) {
      fail(e, 'Could not send a code. Check the number.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    setBusy(true);
    reset();
    try {
      await login(phone.trim(), code.trim());
    } catch (e) {
      fail(e, 'That code did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function emailSignIn(): Promise<void> {
    setBusy(true);
    reset();
    try {
      await client.loginWithEmail({ email: email.trim(), password });
      await completeSignIn();
    } catch (e) {
      fail(e, 'Could not sign in. Check your email and password.');
    } finally {
      setBusy(false);
    }
  }

  async function registerEmail(): Promise<void> {
    setBusy(true);
    reset();
    try {
      await client.registerWithEmail({
        email: email.trim(),
        password,
        name: name.trim(),
        ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
      });
      await completeSignIn();
    } catch (e) {
      fail(e, 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotRequest(): Promise<void> {
    setBusy(true);
    reset();
    try {
      await client.requestPasswordReset(email.trim());
      setForgotSent(true);
      setInfo('If that email has an account, we sent a reset code. Enter it below.');
    } catch (e) {
      fail(e, 'Could not start a password reset.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotConfirm(): Promise<void> {
    setBusy(true);
    reset();
    try {
      await client.confirmPasswordReset({ token: resetToken.trim(), password: newPassword });
      setForgotSent(false);
      setResetToken('');
      setNewPassword('');
      setPassword('');
      setMode('email');
      setInfo('Password reset. Sign in with your new password.');
    } catch (e) {
      fail(e, 'That reset code did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: OAuthProvider): Promise<void> {
    setBusy(true);
    reset();
    try {
      const idToken = await getProviderIdToken(provider);
      await client.oauthSignIn({ provider, idToken });
      await completeSignIn();
    } catch (e) {
      // OAuthUnavailableError → an honest "coming with the app update" message (never a fake sign-in).
      setError(e instanceof OAuthUnavailableError ? e.message : e instanceof ApiError ? e.message : `Could not sign in with ${provider}.`);
    } finally {
      setBusy(false);
    }
  }

  const providerButtons = (
    <View style={{ gap: 10 }}>
      <Button testID="oauth-apple" label="Continue with Apple" icon="smartphone" variant="outline" tone="neutral" onPress={() => void oauth('apple')} disabled={busy} haptic="selection" />
      <Button testID="oauth-google" label="Continue with Google" icon="chrome" variant="outline" tone="neutral" onPress={() => void oauth('google')} disabled={busy} haptic="selection" />
    </View>
  );

  const orDivider = (
    <View style={styles.dividerRow}>
      <View style={[styles.line, { backgroundColor: colors.hairline }]} />
      <Text variant="caption" color="tertiary" style={{ marginHorizontal: 10 }}>
        or
      </Text>
      <View style={[styles.line, { backgroundColor: colors.hairline }]} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: colors.canvas }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Hero testID="login-hero" padding={28}>
            <View style={styles.heroInner}>
              {/* The crest PNG already carries the "ROYAL — Dry Cleaning & Laundry" wordmark, so no second text wordmark. */}
              <Image source={ROYAL_LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="Royal Dry Cleaning & Laundry" />
              <Text variant="subhead" color="secondary" center style={{ marginTop: space.md }}>
                Specialty cleaning, tracked door to door.
              </Text>
            </View>
          </Hero>
        </View>

        {mode === 'phone' && (
          <Card style={styles.form}>
            <Input testID="phone-input" label="Your phone number" icon="phone" value={phone} onChangeText={setPhone} placeholder="+1 416 555 0010" keyboardType="phone-pad" autoCapitalize="none" autoCorrect={false} returnKeyType="go" onSubmitEditing={() => phone.trim().length >= 8 && void sendCode()} />
            <Button testID="send-code" label="Send code" icon="arrow-right" onPress={sendCode} busy={busy} disabled={phone.trim().length < 8} />
            {orDivider}
            {providerButtons}
            <Button testID="go-email" label="Sign in with email" icon="mail" variant="ghost" tone="neutral" onPress={() => go('email')} disabled={busy} haptic="selection" />
          </Card>
        )}

        {mode === 'code' && (
          <Card style={styles.form}>
            <Text variant="subhead" color="secondary">
              Enter the 6-digit code sent to{' '}
              <Text variant="subhead" weight="600">
                {phone}
              </Text>
            </Text>
            <Input testID="code-input" value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" maxLength={6} textAlign="center" style={styles.codeInput} />
            {devCode ? (
              <View style={[styles.devHint, { backgroundColor: colors.honeyTint, borderRadius: radius.input }]}>
                <Feather name="terminal" size={13} color={colors.onHoney} style={{ marginRight: 6 }} />
                <Text variant="footnote" style={{ color: colors.onHoney }}>
                  Dev code: <Text variant="footnote" weight="700" mono style={{ color: colors.onHoney }}>{devCode}</Text>
                </Text>
              </View>
            ) : null}
            <Button testID="verify" label="Verify & sign in" onPress={verify} busy={busy} disabled={code.trim().length !== 6} />
            <Button testID="go-phone" variant="ghost" tone="neutral" label="Use a different number" onPress={() => go('phone')} disabled={busy} haptic="selection" />
          </Card>
        )}

        {mode === 'email' && (
          <Card style={styles.form}>
            <Input testID="email-input" label="Email" icon="mail" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" />
            <Input testID="password-input" label="Password" icon="lock" value={password} onChangeText={setPassword} placeholder="Your password" secureTextEntry autoCapitalize="none" textContentType="password" />
            <Button testID="email-signin" label="Sign in" icon="arrow-right" onPress={emailSignIn} busy={busy} disabled={email.trim().length < 3 || password.length < 1} />
            <View style={styles.linkRow}>
              <LinkText testID="go-forgot" label="Forgot password?" onPress={() => go('forgot')} />
              <LinkText testID="go-register" label="Create account" onPress={() => go('register')} />
            </View>
            {orDivider}
            {providerButtons}
            <Button testID="go-phone" label="Use phone instead" icon="phone" variant="ghost" tone="neutral" onPress={() => go('phone')} disabled={busy} haptic="selection" />
          </Card>
        )}

        {mode === 'register' && (
          <Card title="Create your account" style={styles.form}>
            <Input testID="name-input" label="Your name" icon="user" value={name} onChangeText={setName} placeholder="Alex Rivera" autoCapitalize="words" />
            <Input testID="email-input" label="Email" icon="mail" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" />
            <Input testID="password-input" label="Password" icon="lock" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" textContentType="newPassword" hint="At least 8 characters." />
            <Input testID="referral-input" label="Referral code (optional)" icon="user-plus" value={referralCode} onChangeText={setReferralCode} placeholder="From a friend’s invite" autoCapitalize="characters" autoCorrect={false} />
            <Button testID="register-submit" label="Create account" icon="arrow-right" onPress={registerEmail} busy={busy} disabled={name.trim().length < 1 || email.trim().length < 3 || password.length < 8} />
            <LinkText testID="go-email" label="Have an account? Sign in" onPress={() => go('email')} center />
          </Card>
        )}

        {mode === 'forgot' && (
          <Card title="Reset your password" style={styles.form}>
            <Input testID="email-input" label="Email" icon="mail" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            <Button testID="forgot-send" label={forgotSent ? 'Resend reset code' : 'Send reset code'} icon="send" variant={forgotSent ? 'outline' : 'solid'} onPress={forgotRequest} busy={busy} disabled={email.trim().length < 3} />
            {forgotSent && (
              <>
                <Input testID="reset-token-input" label="Reset code (from your email)" icon="key" value={resetToken} onChangeText={setResetToken} placeholder="Paste the code" autoCapitalize="none" autoCorrect={false} />
                <Input testID="reset-password-input" label="New password" icon="lock" value={newPassword} onChangeText={setNewPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" textContentType="newPassword" />
                <Button testID="reset-submit" label="Reset password" onPress={forgotConfirm} busy={busy} disabled={resetToken.trim().length < 10 || newPassword.length < 8} />
              </>
            )}
            <Button testID="go-email" label="Back to sign in" variant="ghost" tone="neutral" onPress={() => go('email')} disabled={busy} haptic="selection" />
          </Card>
        )}

        {info ? (
          <View style={[styles.banner, { backgroundColor: colors.azureTint, borderRadius: radius.input }]}>
            <Feather name="info" size={14} color={colors.azure} style={{ marginRight: 6 }} />
            <Text testID="login-info" variant="footnote" color="azure" style={styles.bannerText}>
              {info}
            </Text>
          </View>
        ) : null}
        {error ? (
          <View style={[styles.banner, { backgroundColor: colors.dangerTint, borderRadius: radius.input }]}>
            <Feather name="alert-circle" size={14} color={colors.danger} style={{ marginRight: 6 }} />
            <Text testID="login-error" variant="footnote" color="danger" style={styles.bannerText}>
              {error}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LinkText({ testID, label, onPress, center }: { testID: string; label: string; onPress: () => void; center?: boolean }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={8} style={center ? { alignSelf: 'center' } : undefined} accessibilityRole="button">
      <Text variant="footnote" weight="600" style={{ color: colors.azure }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  hero: { marginBottom: 24 },
  heroInner: { alignItems: 'center' },
  logo: { width: 120, height: 120 },
  form: { gap: 14, marginTop: 4 },
  codeInput: { fontSize: 26, letterSpacing: 8, fontVariant: ['tabular-nums'] },
  devHint: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between' },
  banner: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  bannerText: { flex: 1 },
});
