import { MemoryTokenStore } from '@blue-bee/api-client';
import { DevicePlatform } from '@blue-bee/shared';
import { ApiClient } from './client';

interface Captured {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

function setup(status = 200, responseBody: unknown = {}) {
  const calls: Captured[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return { ok: status >= 200 && status < 300, status, json: async () => responseBody } as unknown as Response;
  }) as unknown as typeof fetch;
  const store = new MemoryTokenStore();
  void store.setTokens('access-1', 'refresh-1');
  const client = new ApiClient('http://api', store);
  return { client, calls, last: () => calls[calls.length - 1]! };
}

describe('Owner ApiClient routes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fleetLive hits GET /fleet/live', async () => {
    const { client, last } = setup(200, { vehicles: [], withoutPosition: [] });
    await client.fleetLive();
    expect(last().url).toBe('http://api/v1/fleet/live');
    expect(last().method).toBe('GET');
  });

  it('the three owner reads hit /owner/today|approvals|exceptions', async () => {
    const { client, calls } = setup(200, {});
    await client.today();
    await client.approvals();
    await client.exceptions();
    expect(calls[0]!.url).toBe('http://api/v1/owner/today');
    expect(calls[1]!.url).toBe('http://api/v1/owner/approvals');
    expect(calls[2]!.url).toBe('http://api/v1/owner/exceptions');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('approveQuote / declineQuote use the COLON-action routes (server-authoritative)', async () => {
    const { client, calls } = setup(200, {});
    await client.approveQuote('o1', { note: 'ok' });
    await client.declineQuote('o1');
    expect(calls[0]!.url).toBe('http://api/v1/orders/o1/quote:approve');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toEqual({ note: 'ok' });
    expect(calls[1]!.url).toBe('http://api/v1/orders/o1/quote:decline');
  });

  it('drill-through reads hit /orders/:id, /routes/:id and /routes?status=', async () => {
    const { client, calls } = setup(200, {});
    await client.getOrder('o1');
    await client.getRoute('r1');
    await client.listRoutes('IN_PROGRESS');
    expect(calls[0]!.url).toBe('http://api/v1/orders/o1');
    expect(calls[1]!.url).toBe('http://api/v1/routes/r1');
    expect(calls[2]!.url).toBe('http://api/v1/routes?status=IN_PROGRESS&limit=100');
  });

  it('accessToken returns the stored access token (for the WS handshake)', async () => {
    const { client } = setup();
    expect(await client.accessToken()).toBe('access-1');
  });

  it('deleteAccount issues DELETE /v1/account with auth', async () => {
    const { client, last } = setup(200, { status: 'deleted' });
    await client.deleteAccount();
    expect(last().url).toBe('http://api/v1/account');
    expect(last().method).toBe('DELETE');
    expect(last().headers.authorization).toBe('Bearer access-1');
  });

  it('device-token register/unregister hit /device-tokens (inherited)', async () => {
    const { client, calls } = setup(200, { id: 'd1', platform: 'IOS', token: 't', active: true, createdAt: 'now' });
    await client.registerDeviceToken({ token: 'ExponentPushToken[x]', platform: DevicePlatform.IOS });
    expect(calls[0]!.url).toBe('http://api/v1/device-tokens');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toMatchObject({ token: 'ExponentPushToken[x]', platform: 'IOS' });
    const del = setup(204, {});
    await del.client.unregisterDeviceToken('ExponentPushToken[x]');
    expect(del.last().url).toBe('http://api/v1/device-tokens');
    expect(del.last().method).toBe('DELETE');
  });
});
