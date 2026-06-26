import Constants from 'expo-constants';

/**
 * The API base URL (no trailing slash). Resolved from an EXPO_PUBLIC_ env override (inlined at
 * build time), then app.json `extra.apiBaseUrl`, then a localhost dev default. On a SIMULATOR
 * localhost reaches the host machine; on a PHYSICAL device set EXPO_PUBLIC_API_BASE_URL to the
 * host's LAN IP (e.g. http://192.168.1.20:3000) so the device can reach the API.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? 'http://localhost:3000';
