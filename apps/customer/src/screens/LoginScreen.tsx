import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';

/**
 * Phone-OTP login (PRD §8.1, Increment 2 flow) — the SAME proven flow as the driver app, on the
 * shared session seam. Request a code → enter it → verify. In dev the console SMS transport echoes
 * the code (`devCode`), so the flow is testable without a real phone.
 */
export function LoginScreen(): React.ReactElement {
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Blue Bee</Text>
      <Text style={styles.subtitle}>Specialty cleaning, tracked door to door.</Text>

      {step === 'phone' ? (
        <>
          <Text style={styles.label}>Your phone number</Text>
          <TextInput
            testID="phone-input"
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+14165550010"
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PrimaryButton testID="send-code" label="Send code" onPress={sendCode} busy={busy} disabled={phone.trim().length < 8} />
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the 6-digit code sent to {phone}</Text>
          <TextInput
            testID="code-input"
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
          />
          {devCode ? <Text style={styles.devHint}>dev code: {devCode}</Text> : null}
          <PrimaryButton testID="verify" label="Verify & sign in" onPress={verify} busy={busy} disabled={code.trim().length !== 6} />
          <TouchableOpacity onPress={() => setStep('phone')} disabled={busy}>
            <Text style={styles.linkText}>Use a different number</Text>
          </TouchableOpacity>
        </>
      )}

      {error ? (
        <Text style={styles.error} testID="login-error">
          {error}
        </Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PrimaryButton(props: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; testID?: string }): React.ReactElement {
  return (
    <TouchableOpacity
      testID={props.testID}
      style={[styles.button, (props.disabled || props.busy) && styles.buttonDisabled]}
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
    >
      {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{props.label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff', gap: 12 },
  title: { fontSize: 32, fontWeight: '700', color: '#1f2937', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 14, color: '#374151' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 14, fontSize: 18 },
  devHint: { color: '#6b7280', fontSize: 12 },
  button: { backgroundColor: '#1f6feb', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { color: '#1f6feb', textAlign: 'center', marginTop: 12 },
  error: { color: '#b91c1c', marginTop: 12, textAlign: 'center' },
});
