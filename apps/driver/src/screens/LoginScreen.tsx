import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { ApiError } from '../api/problem';
import { Button, Input, Text, useTheme } from '@blue-bee/ui';

/**
 * Phone-OTP login (PRD §8.1, Increment 2 flow). Request a code → enter it → verify. In dev the
 * console SMS transport echoes the code (`devCode`), so the flow is testable without a real phone.
 */
export function LoginScreen(): React.ReactElement {
  const t = useTheme();
  const { requestOtp, login } = useSession();
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
      if (dc) setCode(dc); // prefill in dev so the proof flow is one tap
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
      // success → SessionProvider flips status to 'signedIn' and the app swaps to the shift screen
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That code did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 14, backgroundColor: t.colors.canvas }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ alignItems: 'center', marginBottom: 8, gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: t.colors.azureTint, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="title1">🐝</Text>
        </View>
        <Text variant="title1" center>
          Blue Bee Driver
        </Text>
        <Text variant="subhead" color={t.colors.textSecondary} center>
          Sign in to start your shift.
        </Text>
      </View>

      {step === 'phone' ? (
        <>
          <Text variant="footnote" color={t.colors.textSecondary}>
            Your phone number
          </Text>
          <Input
            testID="phone-input"
            value={phone}
            onChangeText={setPhone}
            placeholder="+14165550006"
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            icon="phone"
          />
          <Button testID="send-code" label="Send code" onPress={sendCode} busy={busy} disabled={phone.trim().length < 8} size="lg" iconRight="arrow-right" />
        </>
      ) : (
        <>
          <Text variant="footnote" color={t.colors.textSecondary}>
            Enter the 6-digit code sent to {phone}
          </Text>
          <Input testID="code-input" value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" maxLength={6} big />
          {devCode ? (
            <Text variant="caption" color={t.colors.textTertiary}>
              dev code: {devCode}
            </Text>
          ) : null}
          <Button testID="verify" label="Verify & sign in" onPress={verify} busy={busy} disabled={code.trim().length !== 6} size="lg" icon="check" />
          <Pressable
            onPress={() => setStep('phone')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Use a different number"
            style={{ alignSelf: 'center', minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="subhead" weight="600" color={t.colors.azure}>
              Use a different number
            </Text>
          </Pressable>
        </>
      )}

      {error ? (
        <Text testID="login-error" variant="subhead" color={t.colors.danger} center style={{ marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}
