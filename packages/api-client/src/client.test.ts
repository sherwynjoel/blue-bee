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
