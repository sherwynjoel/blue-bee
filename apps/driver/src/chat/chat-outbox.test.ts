import type { ChatMessageDto } from '@blue-bee/shared';
import { ChatOutbox } from './chat-outbox';
import { MemoryOutboxStore, type OutboxItem } from './outbox-store';

function serverMsg(over: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return { id: 'srv-1', orderId: 'o1', threadId: 'o1', fromUserId: 'driver-user', toUserId: 'cust-user', body: 'hi', sentAt: '2026-07-01T12:00:00.000Z', readAt: null, ...over };
}

/** Deterministic id/time generators (no Date.now/Math.random in assertions). */
function outbox(store: MemoryOutboxStore, orderId = 'o1') {
  let n = 0;
  return new ChatOutbox(orderId, store, { genId: () => `local-${++n}`, nowIso: () => `2026-07-01T12:0${n}:00.000Z` });
}

describe('ChatOutbox (durable, offline-honest send-queue, Inc-18)', () => {
  it('enqueue persists a QUEUED item before any network attempt (durable)', async () => {
    const store = new MemoryOutboxStore();
    const ob = outbox(store);
    await ob.init();
    const item = await ob.enqueue('on my way', 'idem-1');
    expect(item.status).toBe('queued');
    expect(ob.pendingCount()).toBe(1);
    // Persisted immediately — a kill right now would not lose it.
    expect(store.snapshot().map((i) => ({ body: i.body, status: i.status }))).toEqual([{ body: 'on my way', status: 'queued' }]);
  });

  it('flush confirms a queued item ONLY after the server responds, then removes it', async () => {
    const store = new MemoryOutboxStore();
    const ob = outbox(store);
    await ob.init();
    await ob.enqueue('hello', 'idem-1');
    const send = jest.fn(async (i: OutboxItem) => serverMsg({ id: `srv-${i.id}`, body: i.body }));
    const res = await ob.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.confirmed.map((m) => m.body)).toEqual(['hello']);
    expect(ob.pendingCount()).toBe(0);
    expect(store.snapshot()).toEqual([]); // confirmed item left the durable queue
  });

  it('a TRANSIENT failure keeps the item queued + persisted (survives relaunch) — never fakes delivery', async () => {
    const store = new MemoryOutboxStore();
    const ob = outbox(store);
    await ob.init();
    await ob.enqueue('are you home?', 'idem-1');
    const failing = jest.fn(async () => { throw new Error('offline'); });
    const res = await ob.flush(failing); // no isPermanent ⇒ transient
    expect(res.ok).toBe(false);
    expect(res.remaining).toBe(1);
    expect(ob.list()[0]!.status).toBe('queued'); // still queued — NOT marked sent
    expect(store.snapshot()[0]!.status).toBe('queued');

    // Simulate an app relaunch: a fresh outbox over the SAME store restores the queued item…
    const revived = outbox(store);
    await revived.init();
    expect(revived.pendingCount()).toBe(1);
    // …and it syncs once the network is back.
    const ok = jest.fn(async (i: OutboxItem) => serverMsg({ id: `srv-${i.id}`, body: i.body }));
    const res2 = await revived.flush(ok);
    expect(res2.confirmed.map((m) => m.body)).toEqual(['are you home?']);
    expect(revived.pendingCount()).toBe(0);
  });

  it('a retry reuses the SAME idempotency key (server-side dedup — no double send)', async () => {
    const store = new MemoryOutboxStore();
    const ob = outbox(store);
    await ob.init();
    await ob.enqueue('ping', 'idem-42');
    const send = jest.fn<Promise<ChatMessageDto>, [OutboxItem]>();
    send.mockRejectedValueOnce(new Error('offline'));
    send.mockResolvedValueOnce(serverMsg({ body: 'ping' }));
    await ob.flush(send); // fails, stays queued
    await ob.flush(send); // retries
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].idempotencyKey).toBe('idem-42');
    expect(send.mock.calls[1]![0].idempotencyKey).toBe('idem-42'); // same key ⇒ server dedups
  });

  it('a PERMANENT rejection (window closed) marks it failed and is not retried', async () => {
    const store = new MemoryOutboxStore();
    const ob = outbox(store);
    await ob.init();
    await ob.enqueue('too late', 'idem-1');
    const send = jest.fn(async () => { throw new Error('chat_read_only'); });
    const res = await ob.flush(send, () => true); // classify as permanent
    expect(res.failed).toBe(1);
    expect(res.remaining).toBe(0);
    expect(ob.list()[0]!.status).toBe('failed');
    // A subsequent flush must NOT retry a failed item.
    const send2 = jest.fn(async (i: OutboxItem) => serverMsg({ body: i.body }));
    await ob.flush(send2);
    expect(send2).not.toHaveBeenCalled();
  });

  it('drains multiple queued messages IN ORDER on a good flush', async () => {
    const store = new MemoryOutboxStore();
    const ob = outbox(store);
    await ob.init();
    await ob.enqueue('first', 'idem-1');
    await ob.enqueue('second', 'idem-2');
    const send = jest.fn(async (i: OutboxItem) => serverMsg({ id: `srv-${i.id}`, body: i.body }));
    const res = await ob.flush(send);
    expect(res.confirmed.map((m) => m.body)).toEqual(['first', 'second']);
    expect(ob.pendingCount()).toBe(0);
  });
});
