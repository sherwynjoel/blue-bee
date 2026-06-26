import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { RoleType, type MeResponse } from '@blue-bee/shared';
import { useAuthSession } from '@blue-bee/api-client';
import { ApiClient } from '../api/client';
import { SecureTokenStore } from '../api/secure-token-store';
import { API_BASE_URL } from '../config';
import { configureNotificationHandler, registerForPush, unregisterFromPush } from '../push/register';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  client: ApiClient;
  /** True only when the signed-in principal holds an OWNER role grant (drives the no-access gate). */
  isOwner: boolean;
  requestOtp(phone: string): Promise<{ devCode?: string }>;
  login(phone: string, code: string): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within <SessionProvider>');
  return value;
}

/** Does this principal hold an OWNER role grant? (The owner cockpit is OWNER-gated — §17.3.) */
export function hasOwnerRole(me: MeResponse | null): boolean {
  return !!me && me.user.roles.some((r) => r.role === RoleType.OWNER);
}

/**
 * The owner session — the app-agnostic auth lifecycle (OTP → keychain → /me → logout-even-offline) is
 * the shared `useAuthSession` from `@blue-bee/api-client`; this provider layers the owner specifics:
 * push registration on sign-in / deactivation on sign-out, and the `isOwner` gate the shell uses to
 * show a no-access screen for a non-owner token (RBAC is also enforced server-side on every read).
 */
export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const clientRef = useRef<ApiClient>(new ApiClient(API_BASE_URL, new SecureTokenStore()));
  const pushTokenRef = useRef<string | null>(null);
  const client = clientRef.current;

  const session = useAuthSession<ApiClient>({
    client,
    onSignedIn: async (c, _me) => {
      // Register push only for an owner principal — a non-owner token is bounced at the gate anyway.
      if (hasOwnerRole(_me)) {
        pushTokenRef.current = await registerForPush(c).catch(() => null);
      }
    },
    onSignOut: async (c) => {
      await unregisterFromPush(c, pushTokenRef.current).catch(() => undefined);
      pushTokenRef.current = null;
    },
  });

  useEffect(() => {
    configureNotificationHandler();
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await session.logout();
  }, [session]);

  const value: SessionValue = {
    status: session.status,
    me: session.me,
    client,
    isOwner: hasOwnerRole(session.me),
    requestOtp: session.requestOtp,
    login: session.login,
    logout,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
