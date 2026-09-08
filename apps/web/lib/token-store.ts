import type { TokenStore } from '@blue-bee/api-client';

/**
 * The web token store — implements the api-client `TokenStore` so the SAME proven transport
 * (single-flight 401→refresh→retry, problem+json→ApiError) runs in the browser unchanged.
 *
 * The access token lives in memory only (a closed tab drops it; disk XSS can't read it). The refresh
 * token is now an httpOnly cookie the SERVER sets and reads directly (see apps/api's
 * auth.controller.ts / refresh-cookie.ts) — this class never sees it, never stores it, and
 * `getRefresh()` always returns null (which `ApiClient.doRefresh()` now correctly treats as "refresh
 * via cookie" rather than "cannot refresh"). This closes the localStorage XSS exposure the previous
 * version explicitly traded off. Nothing here touches `window`/`localStorage`, so it is trivially
 * SSR-safe.
 */
export class WebTokenStore implements TokenStore {
  private access: string | null = null;

  async getAccess(): Promise<string | null> {
    return this.access;
  }

  async getRefresh(): Promise<string | null> {
    return null; // the httpOnly cookie carries this now — never exposed to JS
  }

  async setTokens(accessToken: string, _refreshToken: string): Promise<void> {
    this.access = accessToken;
    // refreshToken is intentionally ignored — the server already set it as an httpOnly cookie
    // on this same response (and, for a trusted browser origin, OMITS it from the JSON body entirely,
    // so it arrives here as `undefined` anyway); persisting it would recreate the exposure we removed.
  }

  async clear(): Promise<void> {
    this.access = null;
    // no localStorage to clear — logout() (via ApiClient) hits /auth/logout, which clears the
    // server-side cookie (see refresh-cookie.ts's clearRefreshCookie).
  }
}
