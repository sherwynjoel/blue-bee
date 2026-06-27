'use client';

import React, { useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { Button, Field, Input } from './ui';
import { Logo } from './Logo';

/**
 * Phone-OTP login for ops staff — reuses the shared `useAuthSession`. In dev (console
 * SMS transport) the requested code is echoed back as `devCode` and prefilled to speed
 * local use. Restyled to Daylight; the auth flow + field contracts are unchanged.
 */
export function Login(): React.ReactElement {
  const { requestOtp, login } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const onRequest = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { devCode } = await requestOtp(phone.trim());
      setStage('code');
      if (devCode) {
        setCode(devCode);
        setHint(`Dev code: ${devCode}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a code. Check the phone number.');
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone.trim(), code.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas p-6">
      {/* ambient Daylight glow */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary-tint blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-[26rem] w-[26rem] rounded-full bg-honey-tint blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-4 text-title3 text-ink">Operator sign-in</p>
          <p className="mt-1 text-footnote text-secondary">Orders · dispatch · fleet · finance</p>
        </div>

        <div className="rounded-card border border-hairline bg-surface p-6 shadow-e2">
          {stage === 'phone' ? (
            <form onSubmit={onRequest} className="space-y-4">
              <Field label="Phone number">
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="+14165550001"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoFocus
                  aria-label="Phone number"
                  className="font-mono"
                />
              </Field>
              {error && <p className="text-footnote font-medium text-danger">{error}</p>}
              <Button type="submit" loading={busy} className="w-full" disabled={!phone.trim()}>
                Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={onVerify} className="space-y-4">
              <Field label="6-digit code" helper={hint ?? undefined}>
                <Input
                  inputMode="numeric"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                  aria-label="Verification code"
                  className="text-center font-mono text-title3 tracking-[0.4em]"
                />
              </Field>
              {error && <p className="text-footnote font-medium text-danger">{error}</p>}
              <Button type="submit" loading={busy} className="w-full" disabled={!code.trim()}>
                <KeyRound className="h-4 w-4" aria-hidden="true" /> Sign in
              </Button>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded text-footnote text-secondary hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
                onClick={() => setStage('phone')}
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Use a different number
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-caption text-tertiary">Back-of-house operations console · Blue Bee</p>
      </div>
    </main>
  );
}
