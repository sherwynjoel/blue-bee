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

describe('ApiClient (driver app)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('verifyOtp stores the token pair', async () => {
    const store = new MemoryTokenStore();
    const client = new ApiClient('http://api', store);
    global.fetch = jest.fn(async () =>
      jsonRes(200, { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 }),
    ) as unknown as typeof fetch;

    const pair = await client.verifyOtp('+14165550006', '123456');
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
          ? jsonRes(200, { user: { name: 'Sam' }, org: { id: 'o', name: 'Org' } })
          : jsonRes(401, { title: 'token_expired' });
      }
      return jsonRes(404, {});
    }) as unknown as typeof fetch;

    const me = (await client.me()) as { user: { name: string } };
    expect(me.user.name).toBe('Sam');
    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(2); // original 401 + replay
    expect(await store.getAccess()).toBe('new-access');
  });

  it('collapses concurrent 401s into a SINGLE refresh (single-flight)', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('old-access', 'refresh-1');
    const client = new ApiClient('http://api', store);

    let refreshCalls = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) {
        refreshCalls += 1;
        return jsonRes(200, { accessToken: 'new-access', refreshToken: 'refresh-2', tokenType: 'Bearer', expiresIn: 900 });
      }
      if (u.includes('/driver/assignment')) {
        return authOf(init) === 'Bearer new-access' ? jsonRes(200, { driverId: 'd', shift: null, route: null }) : jsonRes(401, {});
      }
      return jsonRes(404, {});
    }) as unknown as typeof fetch;

    await Promise.all([client.getAssignment(), client.getAssignment(), client.getAssignment()]);
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

  it('a §5.4 409 surfaces as ApiError.isConflict with the problem code', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('a', 'r');
    const client = new ApiClient('http://api', store);
    global.fetch = jest.fn(async (url: string) => {
      expect(String(url)).toContain('/driver/stops/stop-1/arrive');
      return jsonRes(409, { error: 'illegal_stop_transition', message: 'Illegal stop transition' });
    }) as unknown as typeof fetch;

    const err = (await client.stopAction('stop-1', 'arrive').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isConflict).toBe(true);
    expect(err.code).toBe('illegal_stop_transition');
  });

  it('deleteAccount issues DELETE /v1/account with auth', async () => {
    const store = new MemoryTokenStore();
    await store.setTokens('access-1', 'refresh-1');
    const client = new ApiClient('http://api', store);

    let lastUrl = '';
    let lastMethod: string | undefined;
    let lastAuth: string | undefined;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      lastUrl = String(url);
      lastMethod = init?.method;
      lastAuth = authOf(init);
      return jsonRes(200, { status: 'deleted' });
    }) as unknown as typeof fetch;

    await client.deleteAccount();
    expect(lastUrl).toBe('http://api/v1/account');
    expect(lastMethod).toBe('DELETE');
    expect(lastAuth).toBe('Bearer access-1');
  });
});
