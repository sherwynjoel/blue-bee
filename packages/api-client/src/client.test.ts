import { ApiClient } from './client';
import { ApiError } from './problem';
import { MemoryTokenStore } from './token-store';

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function authOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

/** A tiny subclass so we can exercise the protected transport (mirrors how each app extends it). */
class TestClient extends ApiClient {
  ping(): Promise<{ ok: boolean }> {
    return this.request('GET', '/ping');
  }
  book(body: unknown, idempotencyKey: string): Promise<{ id: string }> {
    return this.request('POST', '/orders', { body, idempotencyKey });
  }
}

/**
 * Models the WEB token store's contract (Task 6): the access token lives in memory, but the refresh
 * token is an httpOnly cookie the JS never sees — so `getRefresh()` ALWAYS resolves null and
 * `setTokens()` ignores whatever refresh value it's handed (the server also omits it from the body for
 * a trusted browser origin, so it's `undefined` at runtime). Used to prove `doRefresh()` refreshes via
 * the cookie (empty body) instead of short-circuiting to `false` when it holds no token.
 */
class CookieOnlyStore extends MemoryTokenStore {
  override async getRefresh(): Promise<string | null> {
    return null;
  }
}

describe('@blue-bee/api-client ApiClient (extracted transport)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('verifyOtp stores the token pair', async () => {
    const store = new MemoryTokenStore();
    const client = new ApiClient('http://api', store);
    global.fetch = jest.fn(async () =>
      jsonRes(200, { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 }),
    ) as unknown as typeof fetch;

    const pair = await client.verifyOtp('+14165550010', '123456');
    expect(pair.accessToken).toBe('a1');
    expect(await store.getAccess()).toBe('a1');
    expect(await store.getRefresh()).toBe('r1');
  });

  it('on a 401 it refreshes once and replays the request', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('old-access', 'refresh-1');
    const client = new ApiClient('http://api', store);

    let refreshCalls = 0;
    let meCalls = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) {
        refreshCalls += 1;
        return jsonRes(200, { accessToken: 'new-access', refreshToken: 'refresh-2', tokenType: 'Bearer', expiresIn: 900 });
      }
      if (u.endsWith('/v1/me')) {
        meCalls += 1;
        return authOf(init) === 'Bearer new-access'
          ? jsonRes(200, { user: { name: 'Rita' }, org: { id: 'o', name: 'Org' } })
          : jsonRes(401, { title: 'token_expired' });
      }
      return jsonRes(404, {});
    }) as unknown as typeof fetch;

    const me = (await client.me()) as { user: { name: string } };
    expect(me.user.name).toBe('Rita');
    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(2); // original 401 + replay
    expect(await store.getAccess()).toBe('new-access');
  });

  it('collapses concurrent 401s into a SINGLE refresh (single-flight)', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('old-access', 'refresh-1');
    const client = new TestClient('http://api', store);

    let refreshCalls = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) {
        refreshCalls += 1;
        return jsonRes(200, { accessToken: 'new-access', refreshToken: 'refresh-2', tokenType: 'Bearer', expiresIn: 900 });
      }
      if (u.endsWith('/v1/ping')) {
        return authOf(init) === 'Bearer new-access' ? jsonRes(200, { ok: true }) : jsonRes(401, {});
      }
      return jsonRes(404, {});
    }) as unknown as typeof fetch;

    await Promise.all([client.ping(), client.ping(), client.ping()]);
    expect(refreshCalls).toBe(1); // one shared refresh for all three concurrent 401s
  });

  it('a failed refresh clears the session and surfaces the 401', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('old-access', 'refresh-1');
    const client = new ApiClient('http://api', store);

    global.fetch = jest.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) return jsonRes(401, { title: 'refresh_reuse_detected' });
      if (u.endsWith('/v1/me')) return jsonRes(401, { title: 'token_expired' });
      return jsonRes(404, {});
    }) as unknown as typeof fetch;

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(await store.getAccess()).toBeNull(); // cleared → forces a fresh login
    expect(await store.getRefresh()).toBeNull();
  });

  it('a 409 surfaces as ApiError.isConflict with the problem code (server-authority re-sync)', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('a', 'r');
    const client = new TestClient('http://api', store);
    global.fetch = jest.fn(async () =>
      jsonRes(409, { error: 'quote_expired', message: 'The quote has expired' }),
    ) as unknown as typeof fetch;

    const err = (await client.book({}, 'k1').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isConflict).toBe(true);
    expect(err.code).toBe('quote_expired');
  });

  it('sends an Idempotency-Key header when provided (replay-safe booking)', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('a', 'r');
    const client = new TestClient('http://api', store);
    let seenKey: string | undefined;
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      seenKey = headerOf(init, 'idempotency-key');
      return jsonRes(201, { id: 'order-1' });
    }) as unknown as typeof fetch;

    const r = await client.book({ accountId: 'acc' }, 'idem-123');
    expect(r.id).toBe('order-1');
    expect(seenKey).toBe('idem-123');
  });

  it("sends credentials: 'include' on every fetch (so the httpOnly refresh cookie rides along)", async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('a', 'r');
    const client = new TestClient('http://api', store);
    const inits: (RequestInit | undefined)[] = [];
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      inits.push(init);
      return jsonRes(200, { ok: true });
    }) as unknown as typeof fetch;

    await client.ping();
    expect(inits).toHaveLength(1);
    expect(inits[0]?.credentials).toBe('include');
  });

  it('with NO stored refresh token, doRefresh() still POSTs /auth/refresh (empty body + credentials) — cookie refresh', async () => {
    // Models the web console: access in memory, refresh only in the httpOnly cookie (getRefresh() → null).
    const store = new CookieOnlyStore();
    await store.setTokens('old-access', 'ignored');
    const client = new ApiClient('http://api', store);

    let refreshCalls = 0;
    let meCalls = 0;
    let refreshInit: RequestInit | undefined;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) {
        refreshCalls += 1;
        refreshInit = init;
        // Trusted-browser refresh (Task 5): the server OMITS refreshToken from the body — the cookie carries it.
        return jsonRes(200, { accessToken: 'new-access', tokenType: 'Bearer', expiresIn: 900 });
      }
      if (u.endsWith('/v1/me')) {
        meCalls += 1;
        return authOf(init) === 'Bearer new-access'
          ? jsonRes(200, { user: { name: 'Rita' }, org: { id: 'o', name: 'Org' } })
          : jsonRes(401, { title: 'token_expired' });
      }
      return jsonRes(404, {});
    }) as unknown as typeof fetch;

    const me = (await client.me()) as { user: { name: string } };
    expect(me.user.name).toBe('Rita'); // it recovered via the cookie refresh instead of failing
    expect(refreshCalls).toBe(1); // did NOT short-circuit to false on a null stored token
    expect(meCalls).toBe(2); // original 401 + replay after refresh
    expect(refreshInit?.credentials).toBe('include'); // the httpOnly cookie must flow
    expect(refreshInit?.body).toBe('{}'); // empty body — no token in JS to send; the cookie is authoritative
    expect(await store.getAccess()).toBe('new-access');
  });

  it('does not attach Authorization on auth:false calls (OTP request)', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('should-not-be-sent', 'r');
    const client = new ApiClient('http://api', store);
    let sentAuth: string | undefined = 'unset';
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      sentAuth = authOf(init);
      return jsonRes(200, { challengeId: 'c', expiresAt: new Date(0).toISOString(), resendInSeconds: 30, devCode: '123456' });
    }) as unknown as typeof fetch;

    const r = await client.requestOtp('+14165550010');
    expect(r.devCode).toBe('123456');
    expect(sentAuth).toBeUndefined();
  });
});
