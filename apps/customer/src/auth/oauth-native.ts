import type { OAuthProvider } from '@blue-bee/shared';

/** Thrown when on-device provider sign-in isn't wired in this build yet (honest — never a fake token). */
export class OAuthUnavailableError extends Error {
  constructor(public readonly provider: OAuthProvider) {
    super(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in isn’t set up in this app build yet.`);
    this.name = 'OAuthUnavailableError';
  }
}

/**
 * [Inc-35] Acquire a provider ID token ON-DEVICE to hand to `POST /v1/auth/oauth`, which verifies it
 * SERVER-SIDE (real JWKS RS256 verification). The backend half is built + e2e-tested now.
 *
 * The native acquisition — `expo-apple-authentication` (Apple) and `expo-auth-session` (Google) — plus the
 * founder-supplied client IDs are wired in the batched EAS build (Metro resolves those native modules at
 * bundle time, so they can't be referenced until they're installed + configured with real sandbox client
 * IDs). Until then this throws {@link OAuthUnavailableError} so the button is HONEST: it never fabricates a
 * token or a fake success. When the deps + client IDs land, this is the ONLY file that changes — the
 * button, the client call, and the whole server path already work.
 */
export async function getProviderIdToken(provider: OAuthProvider): Promise<string> {
  throw new OAuthUnavailableError(provider);
}
