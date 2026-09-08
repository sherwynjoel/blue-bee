import type { TokenStore } from '@blue-bee/api-client';

/**
 * LEGACY key from the pre-cookie era, when the refresh token was persisted in `localStorage`.
 * Nothing reads this anymore — it exists ONLY so the constructor below can purge it once. Anyone
 * who was already logged in before this migration shipped still has a real, JS-readable refresh
 * token sitting under this key; if we simply stopped touching it (as this class did before this
 * fix), it would sit there for up to its 30-day TTL, leaving every pre-existing session exactly as
 * exposed to XSS as before the httpOnly-cookie migration. Do not reintroduce reads/writes here —
 * only the one-time removal below.
 */
const LEGACY_REFRESH_KEY = 'bb.console.refresh';

/**
 * The web token store — implements the api-client `TokenStore` so the SAME proven transport
 * (single-flight 401→refresh→retry, problem+json→ApiError) runs in the browser unchanged.
 *
 * The access token lives in memory only (a closed tab drops it; disk XSS can't read it). The refresh
 * token is now an httpOnly cookie the SERVER sets and reads directly (see apps/api's
 * auth.controller.ts / refresh-cookie.ts) — this class never sees it, never stores it, and
 * `getRefresh()` always returns null (which `ApiClient.doRefresh()` now correctly treats as "refresh
 * via cookie" rather than "cannot refresh"). This closes the localStorage XSS exposure the previous
 * version explicitly traded off. Nothing here touches `window`/`localStorage` for the ACTIVE token
 * flow, so it is trivially SSR-safe; the constructor makes one narrowly-scoped, SSR-guarded
 * exception to purge the stranded legacy key above (see `LEGACY_REFRESH_KEY`).
 */
export class WebTokenStore implements TokenStore {
  private access: string | null = null;

  constructor() {
    // One-time cleanup: a user who was logged in before this migration has a real refresh token
    // still sitting in localStorage under the old key. Nothing else in this app ever reads or
    // writes it anymore, so it would otherwise never be removed. `typeof window` guards SSR (this
    // class is also instantiated during server-side rendering, where `window` doesn't exist).
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LEGACY_REFRESH_KEY);
    }
  }

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
    // no ACTIVE localStorage to clear here — logout() (via ApiClient) hits /auth/logout, which
    // clears the server-side cookie (see refresh-cookie.ts's clearRefreshCookie). The one-time
    // legacy-key purge already happened in the constructor above, not here.
  }
}
