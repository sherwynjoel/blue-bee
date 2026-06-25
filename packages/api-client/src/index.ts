/**
 * @blue-bee/api-client — the shared client seam for the Blue Bee Expo apps.
 *
 * Hand-written (NOT OpenAPI-generated) typed transport over the proven `/v1` API, extracted from the
 * driver app (Increment 9) so the customer app (Increment 11) reuses it instead of reinventing it:
 *   • ApiClient        — fetch transport + injectable TokenStore + single-flight 401→refresh→retry,
 *                        problem+json→ApiError; subclass it to add an app's domain endpoints.
 *   • ApiError         — typed RFC-7807 problem+json error (status / code / isUnauthorized / isConflict).
 *   • TokenStore       — the keychain seam; MemoryTokenStore for tests + the headless proofs.
 *   • useAuthSession   — the headless auth lifecycle (OTP → keychain → /me → logout-even-offline).
 *
 * This entry is PURE (no native imports) so it loads under Node for the integration proofs; each app
 * provides its own native SecureTokenStore implementation of TokenStore (expo-secure-store).
 */
export { ApiClient } from './client';
export type { HttpMethod, RequestOpts } from './client';
export { ApiError } from './problem';
export type { ProblemDetails } from './problem';
export { MemoryTokenStore } from './token-store';
export type { TokenStore } from './token-store';
export { useAuthSession } from './session';
export type { AuthSession, SessionStatus, UseAuthSessionOptions } from './session';
