import type {
  AccountSecurityView,
  AuthProvider,
  AuthResultView,
  DeviceTokenResult,
  EmailLoginDto,
  MeResponse,
  OAuthSignInDto,
  OtpRequestResult,
  PasswordResetConfirmDto,
  RegisterDeviceTokenDto,
  RegisterDto,
  SetPasswordDto,
  TokenPair,
} from '@blue-bee/shared';
import { ApiError } from './problem';
import type { TokenStore } from './token-store';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOpts {
  body?: unknown;
  auth?: boolean;
  /** When set, sent as the `Idempotency-Key` header so a retried mutation is replay-safe server-side. */
  idempotencyKey?: string;
  /** Internal: false on the post-refresh replay so we never loop. */
  retryOn401?: boolean;
}

/**
 * The Blue Bee API client base — the app-agnostic, fully-typed transport over the PROVEN `/v1`
 * endpoints, shared by the driver and customer Expo apps (and their headless integration proofs)
 * via `@blue-bee/api-client`. Pure TypeScript + global `fetch`, with the token store injected — so
 * the EXACT same logic runs in an app (keychain-backed store) and in Node (memory-backed store).
 *
 * On a 401 it transparently refreshes (single-flight: concurrent 401s share ONE refresh) and replays
 * the request once; a failed refresh clears the session. Non-2xx → a typed `ApiError` (problem+json).
 *
 * Each app subclasses this to add its own domain surface (driver duty loop / customer orders +
 * tracking + media); the auth lifecycle, single-flight refresh, and push device-token registration
 * are common and live here.
 */
export class ApiClient {
  protected readonly base: string;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    baseUrl: string,
    protected readonly store: TokenStore,
  ) {
    this.base = `${baseUrl.replace(/\/$/, '')}/v1`;
  }

  // ───────────── auth ─────────────

  /** Request an OTP. In dev (console SMS transport) the response echoes `devCode`. */
  requestOtp(phone: string): Promise<OtpRequestResult> {
    return this.request('POST', '/auth/otp', { body: { phone }, auth: false });
  }

  async verifyOtp(phone: string, code: string): Promise<TokenPair> {
    const pair = await this.request<TokenPair>('POST', '/auth/verify', { body: { phone, code }, auth: false });
    await this.store.setTokens(pair.accessToken, pair.refreshToken);
    return pair;
  }

  // ───────────── [Inc-35] email+password + OAuth (added ALONGSIDE OTP; all resolve to one account) ─────────────

  /** Register with email + password (mints the account); optional referralCode is captured server-side.
   *  Stores the issued session (like verifyOtp) so the app can complete sign-in. */
  async registerWithEmail(dto: RegisterDto): Promise<AuthResultView> {
    const result = await this.request<AuthResultView>('POST', '/auth/register', { body: dto, auth: false });
    await this.store.setTokens(result.tokens.accessToken, result.tokens.refreshToken);
    return result;
  }

  /** Log in with email + password (rate-limited/locked-out server-side). Stores the issued session. */
  async loginWithEmail(dto: EmailLoginDto): Promise<AuthResultView> {
    const result = await this.request<AuthResultView>('POST', '/auth/login', { body: dto, auth: false });
    await this.store.setTokens(result.tokens.accessToken, result.tokens.refreshToken);
    return result;
  }

  /** Sign in with Apple/Google — the provider ID token is verified SERVER-SIDE; links/creates by verified
   *  email. Stores the issued session. */
  async oauthSignIn(dto: OAuthSignInDto): Promise<AuthResultView> {
    const result = await this.request<AuthResultView>('POST', '/auth/oauth', { body: dto, auth: false });
    await this.store.setTokens(result.tokens.accessToken, result.tokens.refreshToken);
    return result;
  }

  /** Confirm an email with the single-use token from the verification email. */
  verifyEmail(token: string): Promise<{ emailVerified: true }> {
    return this.request('POST', '/auth/email/verify', { body: { token }, auth: false });
  }

  /** Request a password-reset email (enumeration-resistant — always resolves). */
  requestPasswordReset(email: string): Promise<{ devToken?: string }> {
    return this.request('POST', '/auth/password/reset', { body: { email }, auth: false });
  }

  /** Set a new password with the single-use reset token (revokes existing sessions server-side). */
  confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<{ ok: true }> {
    return this.request('POST', '/auth/password/reset/confirm', { body: dto, auth: false });
  }

  /** The signed-in user's linked sign-in methods + verify state (Profile → Login & security). */
  getSecurity(): Promise<AccountSecurityView> {
    return this.request('GET', '/auth/methods');
  }

  /** Set or change the signed-in user's password (links the password method). */
  setPassword(dto: SetPasswordDto): Promise<AccountSecurityView> {
    return this.request('POST', '/auth/password', { body: dto });
  }

  /** Unlink a sign-in method (server refuses to remove your only remaining one). */
  unlinkMethod(provider: AuthProvider): Promise<AccountSecurityView> {
    return this.request('DELETE', `/auth/methods/${provider}`);
  }

  me(): Promise<MeResponse> {
    return this.request('GET', '/me');
  }

  async logout(): Promise<void> {
    const refreshToken = await this.store.getRefresh();
    try {
      await this.request('POST', '/auth/logout', { body: refreshToken ? { refreshToken } : {} });
    } finally {
      await this.store.clear();
    }
  }

  // ───────────── push device tokens (Increment 8) ─────────────

  registerDeviceToken(dto: RegisterDeviceTokenDto): Promise<DeviceTokenResult> {
    return this.request('POST', '/device-tokens', { body: dto });
  }

  unregisterDeviceToken(token: string): Promise<void> {
    return this.request('DELETE', '/device-tokens', { body: { token } });
  }

  // ───────────── transport ─────────────

  protected async request<T>(method: HttpMethod, path: string, opts: RequestOpts = {}): Promise<T> {
    const { body, auth = true, idempotencyKey, retryOn401 = true } = opts;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    if (auth) {
      const token = await this.store.getAccess();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      // Send cookies (incl. the web console's httpOnly `bb_refresh` cookie) on every call so the
      // cookie-based refresh works. No-op for native apps (fetch has no cookie jar there).
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && auth && retryOn401) {
      const refreshed = await this.refreshOnce();
      if (refreshed) return this.request<T>(method, path, { ...opts, retryOn401: false });
    }

    if (!res.ok) throw await ApiError.from(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Single-flight refresh: concurrent 401s collapse into ONE /auth/refresh. */
  private refreshOnce(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = await this.store.getRefresh();
    // A null stored token no longer means "cannot refresh" — the web console keeps its refresh token in
    // an httpOnly cookie (never JS-readable), so we send an EMPTY body and let `credentials: 'include'`
    // carry the cookie. Native apps still hold the token and send it in the body as before.
    const res = await fetch(`${this.base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
    if (!res.ok) {
      await this.store.clear(); // refresh reuse/expiry → force a fresh login
      return false;
    }
    const pair = (await res.json()) as TokenPair;
    await this.store.setTokens(pair.accessToken, pair.refreshToken);
    return true;
  }
}
