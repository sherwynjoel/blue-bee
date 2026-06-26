'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useAuthSession, type AuthSession } from '@blue-bee/api-client';
import { API_BASE_URL } from './config';
import { WebTokenStore } from './token-store';
import { getConsoleClient, type ConsoleApiClient } from './api-client';

const SessionContext = createContext<AuthSession<ConsoleApiClient> | null>(null);

// One long-lived store + client for the app lifetime — the single-flight refresh + token consistency
// live on the instance, so it must NOT be recreated per render.
let storeSingleton: WebTokenStore | null = null;
function consoleClient(): ConsoleApiClient {
  if (!storeSingleton) storeSingleton = new WebTokenStore();
  return getConsoleClient(API_BASE_URL, storeSingleton);
}

/** The auth/session provider — reuses the headless `useAuthSession` (OTP → /me → logout-even-offline). */
export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = useMemo(() => consoleClient(), []);
  const session = useAuthSession<ConsoleApiClient>({ client });
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): AuthSession<ConsoleApiClient> {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used within <SessionProvider>');
  return s;
}
