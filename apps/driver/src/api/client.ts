import type {
  DeviceTokenResult,
  DriverAssignment,
  DriverStopAction,
  LocationBatchDto,
  LocationBatchResult,
  MeResponse,
  OtpRequestResult,
  RegisterDeviceTokenDto,
  StopActionDto,
  StopExceptionDto,
  TokenPair,
} from '@blue-bee/shared';
import { ApiError } from './problem';
import type { TokenStore } from './token-store';

type Method = 'GET' | 'POST' | 'DELETE';
interface RequestOpts {
  body?: unknown;
  auth?: boolean;
  /** Internal: false on the post-refresh replay so we never loop. */
  retryOn401?: boolean;
}

/**
 * The Blue Bee API client for the driver app — a thin, fully-typed wrapper over the PROVEN `/v1`
 * endpoints (auth, the Increment-9 `/v1/driver/*` duty loop, `POST /v1/locations:batch`,
 * `/v1/device-tokens`). Pure TypeScript + global `fetch`, with the token store injected — so the
 * exact same logic runs in the app and in the headless integration proof.
 *
 * On a 401 it transparently refreshes (single-flight: concurrent 401s share ONE refresh) and replays
 * the request once; a failed refresh clears the session. Non-2xx → a typed `ApiError` (problem+json).
 */
export class ApiClient {
  private readonly base: string;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    baseUrl: string,
    private readonly store: TokenStore,
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

  // ───────────── driver duty loop (Increment 9) ─────────────

  getAssignment(): Promise<DriverAssignment> {
    return this.request('GET', '/driver/assignment');
  }

  startShift(shiftId: string): Promise<unknown> {
    return this.request('POST', `/driver/shifts/${shiftId}/start`, { body: {} });
  }

  endShift(shiftId: string): Promise<unknown> {
    return this.request('POST', `/driver/shifts/${shiftId}/end`, { body: {} });
  }

  /** Drive a §5.4 stop transition. fail/skip carry a reason; the rest an optional note. */
  stopAction(stopId: string, action: DriverStopAction, body: StopActionDto | StopExceptionDto = {}): Promise<unknown> {
    return this.request('POST', `/driver/stops/${stopId}/${action}`, { body });
  }

  // ───────────── location ingestion (Increment 5) ─────────────

  postLocations(batch: LocationBatchDto): Promise<LocationBatchResult> {
    return this.request('POST', '/locations:batch', { body: batch });
  }

  // ───────────── push device tokens (Increment 8) ─────────────

  registerDeviceToken(dto: RegisterDeviceTokenDto): Promise<DeviceTokenResult> {
    return this.request('POST', '/device-tokens', { body: dto });
  }

  unregisterDeviceToken(token: string): Promise<void> {
    return this.request('DELETE', '/device-tokens', { body: { token } });
  }

  // ───────────── transport ─────────────

  private async request<T>(method: Method, path: string, opts: RequestOpts = {}): Promise<T> {
    const { body, auth = true, retryOn401 = true } = opts;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) {
      const token = await this.store.getAccess();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && auth && retryOn401) {
      const refreshed = await this.refreshOnce();
      if (refreshed) return this.request<T>(method, path, { body, auth, retryOn401: false });
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
    if (!refreshToken) return false;
    const res = await fetch(`${this.base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
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
