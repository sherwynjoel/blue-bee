import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ShiftStatus, type DriverAssignment, type DriverStopAction, type MeResponse, type StopActionDto, type StopExceptionDto } from '@blue-bee/shared';
import { useAuthSession } from '@blue-bee/api-client';
import { ApiClient } from '../api/client';
import { SecureTokenStore } from '../api/secure-token-store';
import { ApiError } from '../api/problem';
import { API_BASE_URL } from '../config';
import { configureNotificationHandler, registerForPush, unregisterFromPush } from '../push/register';
import { onTrackingChange, startTracking, stopTracking } from '../location/tracker';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  assignment: DriverAssignment | null;
  /** Drives the visible "sharing location" indicator. */
  sharingLocation: boolean;
  requestOtp(phone: string): Promise<{ devCode?: string }>;
  login(phone: string, code: string): Promise<void>;
  logout(): Promise<void>;
  refreshAssignment(): Promise<void>;
  startShift(shiftId: string): Promise<void>;
  endShift(shiftId: string): Promise<void>;
  /** Drive a §5.4 transition; on a 409 the server is authority — we re-sync and rethrow. */
  doStopAction(stopId: string, action: DriverStopAction, body?: StopActionDto | StopExceptionDto): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within <SessionProvider>');
  return value;
}

/**
 * The driver session — the app-agnostic auth lifecycle (OTP → keychain → /me → logout-even-offline)
 * is the shared `useAuthSession` from `@blue-bee/api-client`; this provider layers the driver-specific
 * domain on top: the assignment (shift/route), the GPS-sharing privacy gate (tracking streams only
 * while the shift is ACTIVE), push registration, and the §5.4 stop transitions.
 */
export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const clientRef = useRef<ApiClient>(new ApiClient(API_BASE_URL, new SecureTokenStore()));
  const pushTokenRef = useRef<string | null>(null);
  const client = clientRef.current;

  const [assignment, setAssignment] = useState<DriverAssignment | null>(null);
  const [sharingLocation, setSharingLocation] = useState(false);

  // Load the assignment AND reconcile background tracking with the shift state (the privacy gate:
  // GPS streams only while the shift is ACTIVE).
  const loadAssignment = useCallback(async (): Promise<void> => {
    const next = await client.getAssignment();
    setAssignment(next);
    if (next.shift && next.shift.status === ShiftStatus.ACTIVE) {
      await startTracking(client, next.shift.id, next.shift.vehicleId);
    } else {
      await stopTracking();
    }
  }, [client]);

  // The shared auth core; the driver plugs its side effects into onSignedIn / onSignOut.
  const session = useAuthSession<ApiClient>({
    client,
    onSignedIn: async (c, _me) => {
      pushTokenRef.current = await registerForPush(c).catch(() => null);
      await loadAssignment();
    },
    onSignOut: async (c) => {
      await stopTracking().catch(() => undefined);
      await unregisterFromPush(c, pushTokenRef.current).catch(() => undefined);
      pushTokenRef.current = null;
    },
  });

  // Mirror the tracker's sharing state into the UI + configure the foreground push handler once.
  useEffect(() => {
    configureNotificationHandler();
    return onTrackingChange(setSharingLocation);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await session.logout(); // runs onSignOut (stop tracking + unregister) then clears the session
    setAssignment(null);
  }, [session]);

  const refreshAssignment = useCallback(() => loadAssignment(), [loadAssignment]);

  const startShift = useCallback(
    async (shiftId: string): Promise<void> => {
      await client.startShift(shiftId);
      await loadAssignment(); // shift now ACTIVE → loadAssignment starts tracking
    },
    [client, loadAssignment],
  );

  const endShift = useCallback(
    async (shiftId: string): Promise<void> => {
      await client.endShift(shiftId);
      await stopTracking();
      await loadAssignment();
    },
    [client, loadAssignment],
  );

  const doStopAction = useCallback(
    async (stopId: string, action: DriverStopAction, body: StopActionDto | StopExceptionDto = {}): Promise<void> => {
      try {
        await client.stopAction(stopId, action, body);
      } catch (e) {
        // A 409 means the server's §5.4 state moved out from under us — re-sync to the truth, rethrow.
        if (e instanceof ApiError && e.isConflict) await loadAssignment().catch(() => undefined);
        throw e;
      }
      await loadAssignment();
    },
    [client, loadAssignment],
  );

  const value: SessionValue = {
    status: session.status,
    me: session.me,
    assignment,
    sharingLocation,
    requestOtp: session.requestOtp,
    login: session.login,
    logout,
    refreshAssignment,
    startShift,
    endShift,
    doStopAction,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
