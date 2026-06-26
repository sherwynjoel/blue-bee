'use client';

import React, { useState } from 'react';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Input } from './ui';

/**
 * Phone-OTP login for ops staff (Increment 13) — reuses the shared `useAuthSession`. In dev (console
 * SMS transport) the requested code is echoed back as `devCode` and prefilled to speed local use.
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-bb-ink">🐝 Blue Bee Console</h1>
          <p className="mt-1 text-sm text-bb-sub">Operator sign-in</p>
        </div>
        <Card>
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
                />
              </Field>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <Button type="submit" loading={busy} className="w-full" disabled={!phone.trim()}>
                Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={onVerify} className="space-y-4">
              <Field label="6-digit code">
                <Input
                  inputMode="numeric"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                  aria-label="Verification code"
                />
              </Field>
              {hint && <p className="text-xs text-bb-sub">{hint}</p>}
              {error && <p className="text-sm text-red-700">{error}</p>}
              <Button type="submit" loading={busy} className="w-full" disabled={!code.trim()}>
                Sign in
              </Button>
              <button type="button" className="w-full text-sm text-bb-sub underline" onClick={() => setStage('phone')}>
                Use a different number
              </button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
