import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeResponse } from '@blue-bee/shared';
import { ApiClient } from './client';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

/**
 * The app-agnostic auth/session core, extracted from the driver app so the customer app reuses it
 * (PRD §8.1). It owns ONLY the auth lifecycle — hydrate-on-launch, OTP request, login (verify →
 * /me), and logout-even-offline — and exposes the live client + status to the app. Each app layers
 * its own domain state (driver: shift/route/tracking; customer: nothing extra) on top via its own
 * context provider, plugging app-specific side effects into `onSignedIn` / `onSignOut`
 * (push registration, background tracking, …).
 *
 * The client MUST be a single long-lived instance (created with `useRef` / a module singleton) — the
 * single-flight refresh + token consistency live on the instance, so constructing one per render
 * would defeat them.
 */
export interface AuthSession<C extends ApiClient = ApiClient> {
  status: SessionStatus;
  me: MeResponse | null;
  client: C;
  requestOtp(phone: string): Promise<{ devCode?: string }>;
  login(phone: string, code: string): Promise<void>;
  logout(): Promise<void>;
  /** Re-pull /me (e.g. after a profile/role change); no-op on the signed-out state. */
  reloadMe(): Promise<void>;
}

export interface UseAuthSessionOptions<C extends ApiClient> {
  /** A single long-lived client instance (keychain-backed store in the app). */
  client: C;
  /** Side effects after a successful sign-in (login OR hydrate-on-launch), with the live /me profile. */
  onSignedIn?: (client: C, me: MeResponse) => Promise<void> | void;
  /** Best-effort cleanup during logout, BEFORE the server revoke + local token clear. Never rethrows out. */
  onSignOut?: (client: C) => Promise<void> | void;
}

export function useAuthSession<C extends ApiClient>(opts: UseAuthSessionOptions<C>): AuthSession<C> {
  const { client } = opts;
  // Keep the latest callbacks without re-running the hydrate effect when they change identity.
  const cbRef = useRef(opts);
  cbRef.current = opts;

  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const enter = useCallback(
    async (profile: MeResponse): Promise<void> => {
      setMe(profile);
      setStatus('signedIn');
      await cbRef.current.onSignedIn?.(client, profile);
    },
    [client],
  );

  // Hydrate on launch: a stored token → /me succeeds → signed in; otherwise signed out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await client.me();
        if (cancelled) return;
        await enter(profile);
      } catch {
        if (!cancelled) setStatus('signedOut');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, enter]);

  const requestOtp = useCallback(
    async (phone: string): Promise<{ devCode?: string }> => {
      const result = await client.requestOtp(phone);
      return { devCode: result.devCode };
    },
    [client],
  );

  const login = useCallback(
    async (phone: string, code: string): Promise<void> => {
      await client.verifyOtp(phone, code); // stores tokens in the keychain
      const profile = await client.me();
      await enter(profile);
    },
    [client, enter],
  );

  const logout = useCallback(async (): Promise<void> => {
    // App-specific cleanup first (push unregister, stop tracking, …) — best-effort.
    try {
      await cbRef.current.onSignOut?.(client);
    } catch {
      // best-effort
    }
    // Drop the LOCAL session even if the server logout can't be reached (offline) — client.logout()
    // clears stored tokens in its finally regardless, so the device must not stay "signed in".
    try {
      await client.logout();
    } catch {
      // best-effort server revoke; tokens are already cleared
    }
    setMe(null);
    setStatus('signedOut');
  }, [client]);

  const reloadMe = useCallback(async (): Promise<void> => {
    const profile = await client.me();
    setMe(profile);
  }, [client]);

  return { status, me, client, requestOtp, login, logout, reloadMe };
}
