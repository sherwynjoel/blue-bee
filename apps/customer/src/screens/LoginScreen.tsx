import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../../theme';
import { BeeMark, Button, Input, Text } from '../../components/ui';

/**
 * Phone-OTP login (PRD §8.1, Increment 2 flow) — the SAME proven flow as the driver app, on the
 * shared session seam. Request a code → enter it → verify. In dev the console SMS transport echoes
 * the code (`devCode`), so the flow is testable without a real phone. Daylight reskin: branded bee
 * hero, calm number entry, clear states.
 */
export function LoginScreen(): React.ReactElement {
  const { requestOtp, login } = useSession();
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { devCode: dc } = await requestOtp(phone.trim());
      setDevCode(dc);
      if (dc) setCode(dc); // prefill in dev so the flow is one tap
      setStep('code');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send a code. Check the number.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await login(phone.trim(), code.trim());
      // success → SessionProvider flips status to 'signedIn' and the app swaps to My orders
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That code did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <BeeMark size={84} />
          <Text variant="display" weight="700" style={{ marginTop: space.xl }}>
            Blue Bee
          </Text>
          <Text variant="subhead" color="secondary" center style={{ marginTop: 6 }}>
            Specialty cleaning, tracked door to door.
          </Text>
        </View>

        {step === 'phone' ? (
          <View style={styles.form}>
            <Input
              testID="phone-input"
              label="Your phone number"
              icon="phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 416 555 0010"
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => phone.trim().length >= 8 && void sendCode()}
            />
            <Button testID="send-code" label="Send code" icon="arrow-right" onPress={sendCode} busy={busy} disabled={phone.trim().length < 8} />
          </View>
        ) : (
          <View style={styles.form}>
            <Text variant="subhead" color="secondary">
              Enter the 6-digit code sent to{' '}
              <Text variant="subhead" weight="600">
                {phone}
              </Text>
            </Text>
            <Input
              testID="code-input"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
              style={styles.codeInput}
            />
            {devCode ? (
              <View style={[styles.devHint, { backgroundColor: colors.honeyTint }]}>
                <Text variant="footnote" style={{ color: colors.onHoney }}>
                  Dev code: <Text variant="footnote" weight="700" mono style={{ color: colors.onHoney }}>{devCode}</Text>
                </Text>
              </View>
            ) : null}
            <Button testID="verify" label="Verify & sign in" onPress={verify} busy={busy} disabled={code.trim().length !== 6} />
            <Button variant="ghost" tone="neutral" label="Use a different number" onPress={() => setStep('phone')} disabled={busy} haptic="selection" />
          </View>
        )}

        {error ? (
          <View style={[styles.error, { backgroundColor: colors.dangerTint }]}>
            <Text testID="login-error" variant="footnote" color="danger" center>
              {error}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  hero: { alignItems: 'center', marginBottom: 40 },
  form: { gap: 14 },
  codeInput: { fontSize: 26, letterSpacing: 8, fontVariant: ['tabular-nums'] },
  devHint: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  error: { borderRadius: 12, padding: 12, marginTop: 18 },
});
