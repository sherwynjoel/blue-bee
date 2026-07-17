import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { DevicePlatform } from '@blue-bee/shared';
import type { CustomerApiClient } from '../api/customer-client';

/**
 * Customer push (Increment 11; closes Increment-8's deferred real-device push together with the
 * driver's). Requests notification consent, obtains a REAL Expo push token, and registers it against
 * the proven `POST /v1/device-tokens`; deactivates it on logout. The Inc-8 engine then delivers the
 * geofence approaching/arrived alerts to THIS customer for their own orders — and a tapped push
 * deep-links to that order's tracking via the `data.orderId` the engine now attaches (Increment 11).
 */

/** Show banners/sounds while the app is foregrounded (so an arriving push is visible on screen). */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** A real Expo push token, or null on a simulator / when permission is refused. */
export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // Expo push tokens require a PHYSICAL device
  try {
    const easProjectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const result = await Notifications.getExpoPushTokenAsync(easProjectId ? { projectId: easProjectId } : undefined);
    return result.data;
  } catch (e) {
    console.warn('[push] could not obtain an Expo push token:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

function devicePlatform(): DevicePlatform {
  return Platform.OS === 'android' ? DevicePlatform.ANDROID : DevicePlatform.IOS;
}

/** Request consent, obtain a real Expo token, register it. Returns the token (to deactivate on
 *  logout), or null when consent was refused / no device / no token. */
export async function registerForPush(client: CustomerApiClient): Promise<string | null> {
  if (!(await ensurePermission())) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Royal Cleaners',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  const token = await getExpoPushToken();
  if (!token) return null;
  await client.registerDeviceToken({ token, platform: devicePlatform() });
  return token;
}

/** Best-effort deactivation on logout (a logged-out device must stop receiving pushes). */
export async function unregisterFromPush(client: CustomerApiClient, token: string | null): Promise<void> {
  if (!token) return;
  try {
    await client.unregisterDeviceToken(token);
  } catch {
    // best-effort — the server also reassigns the token on the next user's re-register
  }
}

/**
 * Pull the owning `orderId` out of a tapped-notification response. The Inc-8 engine attaches it as
 * `data.orderId` ONLY on the customer's own geofence pushes (server-scoped), so this never points at
 * another customer's order; the detail/track screens additionally read through the scoped API (a
 * non-owned id 404s). Pure → unit-tested. Returns null when there's no order to open.
 */
export function extractOrderIdFromResponse(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification?.request?.content?.data as { orderId?: unknown } | undefined;
  const orderId = data?.orderId;
  return typeof orderId === 'string' && orderId.length > 0 ? orderId : null;
}

/**
 * Wire push taps → deep-link to the order's tracking. Handles both a warm tap (listener) and a cold
 * start where the app was launched by tapping the push (getLastNotificationResponseAsync).
 */
export function usePushDeepLinks(onOpenOrder: (orderId: string) => void): void {
  useEffect(() => {
    let handledCold = false;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const orderId = extractOrderIdFromResponse(response);
        if (orderId && !handledCold) {
          handledCold = true;
          onOpenOrder(orderId);
        }
      })
      .catch(() => undefined);

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = extractOrderIdFromResponse(response);
      if (orderId) onOpenOrder(orderId);
    });
    return () => sub.remove();
  }, [onOpenOrder]);
}
