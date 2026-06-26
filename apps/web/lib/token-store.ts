import type { TokenStore } from '@blue-bee/api-client';

const REFRESH_KEY = 'bb.console.refresh';

/**
 * The web token store (Increment 13) — implements the api-client `TokenStore` so the SAME proven
 * transport (single-flight 401→refresh→retry, problem+json→ApiError) runs in the browser unchanged.
 *
 * STRATEGY: the **access token lives in memory only** (never persisted → a closed tab drops it, and
 * disk XSS can't read it); the **refresh token is in localStorage**. This is the documented XSS
 * trade-off. The fully-httpOnly-cookie pattern is the recommended hardening but is a follow-up this
 * increment, because (1) the as-built `/auth/refresh` is BODY-based and the api-client assumes one
 * base for all calls incl. refresh — a cookie refresh needs a separate Next BFF origin, which would
 * fork the transport; and (2) the `WS /live/fleet` handshake already needs the access token readable
 * in JS (auth.token). Blast radius is capped by the Inc-2 server-side refresh ROTATION +
 * reuse-detection + access-jti denylist, short access TTL, React's default escaping, and a CSP.
 * SSR-safe: every `window`/`localStorage` access is guarded.
 */
export class WebTokenStore implements TokenStore {
  private access: string | null = null;

  async getAccess(): Promise<string | null> {
    return this.access;
  }

  async getRefresh(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  }

  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    this.access = accessToken;
    if (typeof window !== 'undefined') window.localStorage.setItem(REFRESH_KEY, refreshToken);
  }

  async clear(): Promise<void> {
    this.access = null;
    if (typeof window !== 'undefined') window.localStorage.removeItem(REFRESH_KEY);
  }
}
