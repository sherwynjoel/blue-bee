import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { MeResponse } from '@blue-bee/shared';
import { useAuthSession, type SessionStatus } from '@blue-bee/api-client';
import { CustomerApiClient } from '../api/customer-client';
import { SecureTokenStore } from '../api/secure-token-store';
import { API_BASE_URL } from '../config';
import { configureNotificationHandler, registerForPush, unregisterFromPush } from '../push/register';

interface SessionValue {
  status: SessionStatus;
  me: MeResponse | null;
  /** The single long-lived customer client — screens use it for orders/book/tracking/media. */
  client: CustomerApiClient;
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

/**
 * The customer session — the app-agnostic auth lifecycle (OTP → keychain → /me → logout-even-offline)
 * is the shared `useAuthSession` from `@blue-bee/api-client`; this provider adds only the customer's
 * side effects: registering the Expo push token on sign-in and deactivating it on logout. The single
 * long-lived `CustomerApiClient` (single-flight refresh lives on the instance) is exposed to screens.
 */
export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const clientRef = useRef<CustomerApiClient>(new CustomerApiClient(API_BASE_URL, new SecureTokenStore()));
  const pushTokenRef = useRef<string | null>(null);
  const client = clientRef.current;

  useEffect(() => {
    configureNotificationHandler();
  }, []);

  const session = useAuthSession<CustomerApiClient>({
    client,
    onSignedIn: async (c) => {
      pushTokenRef.current = await registerForPush(c).catch(() => null);
    },
    onSignOut: async (c) => {
      await unregisterFromPush(c, pushTokenRef.current).catch(() => undefined);
      pushTokenRef.current = null;
    },
  });

  const value: SessionValue = {
    status: session.status,
    me: session.me,
    client,
    requestOtp: session.requestOtp,
    login: session.login,
    logout: session.logout,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
