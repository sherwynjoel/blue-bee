import Constants from 'expo-constants';

/**
 * The API base URL (no trailing slash). Resolved from an EXPO_PUBLIC_ env override (inlined at
 * build time), then app.json `extra.apiBaseUrl`, then a localhost dev default. On a SIMULATOR
 * localhost reaches the host machine; on a PHYSICAL device set EXPO_PUBLIC_API_BASE_URL to the
 * host's LAN IP (e.g. http://192.168.1.20:3000) so the device can reach the API.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string; stripePublishableKey?: string };

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? 'http://localhost:3000';

/**
 * The Stripe PUBLISHABLE (non-secret) key for PaymentSheet (Increment 12). TEST key only. The secret
 * key never leaves the API; the card never touches our servers (PCI SAQ-A). Empty until the founder
 * drops a `pk_test_…` here for the on-device run; the create-intent response also returns the server's
 * configured publishable key as a fallback.
 */
export const STRIPE_PUBLISHABLE_KEY: string =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? extra.stripePublishableKey ?? '';
