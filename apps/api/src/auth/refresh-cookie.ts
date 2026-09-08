import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_ERRORS } from '@blue-bee/shared';

/** Path-scoped so the cookie is never sent to non-auth routes (e.g. it won't ride along on /v1/orders). */
export const REFRESH_COOKIE_NAME = 'bb_refresh';
const COOKIE_PATH = '/v1/auth';

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Sets the web console's httpOnly refresh cookie. `SameSite=None` (not Lax/Strict) is required in
 * production because the API and web console are on different Railway subdomains under the PSL-listed
 * `up.railway.app` — they are cross-SITE, and Lax/Strict cookies are never sent cross-site even via
 * fetch/XHR. `Secure` is mandated by the spec whenever `SameSite=None` is used, so it is unconditional
 * in production; local dev (plain HTTP) falls back to `Lax` + non-Secure so cookie-based refresh stays
 * testable without HTTPS. `httpOnly` is ALWAYS on — JavaScript can never read this cookie, which is the
 * entire XSS-hardening point (the raw refresh token never re-enters `document.cookie`/JS again).
 *
 * `SameSite=None` provides ZERO CSRF protection on its own (the browser sends the cookie cross-site by
 * design), so the cookie path is defended by an explicit Origin allow-list check — see `assertTrustedOrigin`.
 */
export function setRefreshCookie(res: Response, token: string, ttlSeconds: number): void {
  const prod = isProd();
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? 'none' : 'lax',
    path: COOKIE_PATH,
    maxAge: ttlSeconds * 1000,
  });
}

/** Clears the refresh cookie. Attributes (path/secure/sameSite) MUST match `setRefreshCookie` or the
 *  browser treats it as a different cookie and won't overwrite/expire the original. */
export function clearRefreshCookie(res: Response): void {
  const prod = isProd();
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? 'none' : 'lax',
    path: COOKIE_PATH,
  });
}

/**
 * CSRF defense for the cookie-based refresh/logout path. `SameSite=None` means the browser WILL send this
 * cookie on a cross-site request — the classic "simple request" CSRF vector (a form POST with no custom
 * headers is sent by ANY origin and bypasses CORS preflight entirely; CORS only blocks the attacker's page
 * from READING the response, never from CAUSING the request's side effect). This check closes that vector:
 * reject unless the caller's `Origin` is one we trust. A request with NO `Origin` header (native apps and
 * most non-browser HTTP clients) is NOT rejected — this defense targets only a BROWSER-driven cross-site
 * attack, and native requests were never subject to it (they authenticate by body token, not by cookie).
 *
 * NOTE: a literal `*` in `allowedOrigins` is treated as an ordinary string here — it will NOT match a
 * concrete origin, so `CORS_ALLOWED_ORIGINS=*` fails CLOSED (every browser refresh/logout gets 403). That
 * is intentional: `*` is fundamentally incompatible with credentialed cookies anyway (a wildcard origin
 * disables `Access-Control-Allow-Credentials`, so the browser would never send the cookie), so the cookie
 * path simply does not support a wildcard — configure the concrete console origin(s) instead.
 */
export function assertTrustedOrigin(req: Request, allowedOrigins: string[]): void {
  const origin = req.headers.origin;
  if (!origin) return; // no Origin header ⇒ not a browser cross-site request (native app, curl, etc.)
  if (!allowedOrigins.includes(origin)) {
    throw new ForbiddenException({ error: AUTH_ERRORS.UNTRUSTED_ORIGIN, message: 'Untrusted origin' });
  }
}

/**
 * True iff the request carries a browser `Origin` header that is on the trust allow-list — i.e. the caller
 * is the web console. Used to decide whether to OMIT the raw refresh token from the JSON response body: the
 * console keeps its token in the httpOnly cookie and must NEVER receive a JS-readable transit copy (an XSS
 * on the trusted origin could otherwise POST /refresh with `credentials:'include'` and read the freshly
 * rotated token straight out of the response body). Native/no-Origin clients return `false` here and keep
 * getting the body token — they have no cookie and it is their only copy.
 */
export function isTrustedBrowserOrigin(req: Request, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  return !!origin && allowedOrigins.includes(origin);
}

/**
 * Parse `CORS_ALLOWED_ORIGINS` (CSV) into a trimmed, non-empty list. Shared by `main.ts` (CORS setup) and
 * `AuthController` (the Origin allow-list above) so the trusted-origin set can never drift between the two.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
