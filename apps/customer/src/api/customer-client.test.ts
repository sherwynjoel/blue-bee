import { ItemKind, PhotoKind } from '@blue-bee/shared';
import { MemoryTokenStore } from '@blue-bee/api-client';
import { CustomerApiClient } from './customer-client';

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
  const client = new CustomerApiClient('http://api', store);
  return { client, calls, last: () => calls[calls.length - 1]! };
}

describe('CustomerApiClient routes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('listOrders builds the cursor query string', async () => {
    const { client, last } = setup(200, { orders: [], nextCursor: null, hasMore: false });
    await client.listOrders({ limit: 25, status: undefined });
    expect(last().url).toBe('http://api/v1/orders?limit=25');
  });

  it('getOrder hits /orders/:id', async () => {
    const { client, last } = setup();
    await client.getOrder('o1');
    expect(last().url).toBe('http://api/v1/orders/o1');
    expect(last().method).toBe('GET');
  });

  it('book POSTs /orders with the body and an Idempotency-Key header', async () => {
    const { client, last } = setup(201, { id: 'o1' });
    await client.book({ accountId: 'acc', items: [{ kind: ItemKind.RUG, serviceId: 'svc' }] }, 'idem-key-1');
    expect(last().url).toBe('http://api/v1/orders');
    expect(last().method).toBe('POST');
    expect(last().headers['idempotency-key']).toBe('idem-key-1');
    expect(last().body).toMatchObject({ accountId: 'acc' });
  });

  it('approveQuote uses the COLON-action route (quote:approve)', async () => {
    const { client, last } = setup(200, {});
    await client.approveQuote('o1', { note: 'ok' });
    expect(last().url).toBe('http://api/v1/orders/o1/quote:approve');
    expect(last().method).toBe('POST');
  });

  it('declineQuote uses the COLON-action route (quote:decline)', async () => {
    const { client, last } = setup(200, {});
    await client.declineQuote('o1');
    expect(last().url).toBe('http://api/v1/orders/o1/quote:decline');
  });

  it('getOrderTracking hits /orders/:id/tracking', async () => {
    const { client, last } = setup(200, { orderId: 'o1', stop: null, vehicle: null, channelToken: null });
    await client.getOrderTracking('o1');
    expect(last().url).toBe('http://api/v1/orders/o1/tracking');
  });

  it('media presign + confirm hit the /media endpoints', async () => {
    const { client, calls } = setup(200, {});
    await client.presignMedia({ orderId: 'o1', kind: PhotoKind.BEFORE, contentType: 'image/jpeg', byteSize: 10 });
    await client.confirmMedia({ storageKey: 'k' });
    expect(calls[0]!.url).toBe('http://api/v1/media/presign');
    expect(calls[1]!.url).toBe('http://api/v1/media/confirm');
  });

  it('catalog reads hit /services and /sites', async () => {
    const { client, calls } = setup(200, {});
    await client.getServices();
    await client.getSites();
    expect(calls[0]!.url).toBe('http://api/v1/services');
    expect(calls[1]!.url).toBe('http://api/v1/sites');
  });
});
