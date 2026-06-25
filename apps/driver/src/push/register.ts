import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { DevicePlatform } from '@blue-bee/shared';
import type { ApiClient } from '../api/client';

/**
 * Push registration (Increment 9 — proves the real-device push deferred in Increment 8). Requests
 * notification consent, obtains a REAL Expo push token, and registers it against the proven
 * `POST /v1/device-tokens` (Increment 8) on login; deactivates it on logout. When the backend then
 * fires a geofence/engine notification, the real token receives a real push on the device.
 */

/** Show banners/sounds while the app is foregrounded (so the proof push is visible on screen). */
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

/**
 * Request consent, obtain a real Expo token, register it. Returns the token (so the app can
 * deactivate it on logout), or null when consent was refused / no device / no token.
 */
export async function registerForPush(client: ApiClient): Promise<string | null> {
  if (!(await ensurePermission())) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Blue Bee',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  const token = await getExpoPushToken();
  if (!token) return null;
  await client.registerDeviceToken({ token, platform: devicePlatform() });
  return token;
}

/** Best-effort deactivation on logout (a logged-out device must stop receiving pushes). */
export async function unregisterFromPush(client: ApiClient, token: string | null): Promise<void> {
  if (!token) return;
  try {
    await client.unregisterDeviceToken(token);
  } catch {
    // best-effort — the server also reassigns the token on the next user's re-register
  }
}
