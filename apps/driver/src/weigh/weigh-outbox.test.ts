import type { WeightCaptureResult } from '@blue-bee/shared';
import { WeighOutbox, MemoryWeighOutboxStore, type WeighQueueItem, type EnqueueWeighInput } from './weigh-outbox';

const input = (over: Partial<EnqueueWeighInput> = {}): EnqueueWeighInput => ({
  stopId: 'stop-1',
  orderLabel: 'ord-1',
  weightKg: 6.5,
  weighPoint: 'PICKUP',
  source: 'driver',
  ...over,
});

const okResult = (weightKg = '6.50'): WeightCaptureResult => ({
  capture: { id: 'srv-cap', orderId: 'o', itemId: null, weightKg, weighPoint: 'PICKUP' as never, capturedByUserId: 'u', capturedAt: '2026-07-10T00:00:00.000Z', source: 'driver', note: null },
  authoritativeWeightKg: weightKg,
  pricing: { status: 'auto_approved', total: '23.73', currency: 'CAD', awaitsCustomerApproval: false, orderStatus: 'QUOTE_APPROVED' as never },
});

class Offline extends Error {}
class Permanent extends Error {}
const isPermanent = (e: unknown): boolean => e instanceof Permanent;

describe('WeighOutbox (Inc-23 P2 durable offline weigh queue)', () => {
  it('persists an approval BEFORE any network call (offline honesty)', async () => {
    const store = new MemoryWeighOutboxStore();
    const outbox = new WeighOutbox(store);
    await outbox.init();
    await outbox.enqueue(input(), 'key-1');
    expect(store.snapshot()).toHaveLength(1); // durable before send
    expect(store.snapshot()[0]!.status).toBe('queued');
    expect(outbox.pendingCount()).toBe(1);
  });

  it('online: flush confirms the approval → it leaves the queue and returns the server result', async () => {
    const store = new MemoryWeighOutboxStore();
    const outbox = new WeighOutbox(store);
    await outbox.init();
    await outbox.enqueue(input(), 'key-1');
    const send = jest.fn(async () => okResult());
    const res = await outbox.flush(send, isPermanent);
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
    expect(res.confirmed[0]!.pricing.total).toBe('23.73');
    expect(outbox.pendingCount()).toBe(0);
    expect(store.snapshot()).toHaveLength(0); // confirmed → gone from the durable store too
  });

  it('OFFLINE then ONLINE: a queued approval survives a relaunch and syncs later (the core offline flow)', async () => {
    const store = new MemoryWeighOutboxStore();
    // Session 1 — approve OFFLINE: enqueue + a failing flush (no signal).
    const outbox1 = new WeighOutbox(store);
    await outbox1.init();
    await outbox1.enqueue(input({ weightKg: 7.2 }), 'key-off');
    const offlineSend = jest.fn(async () => {
      throw new Offline('network request failed');
    });
    const r1 = await outbox1.flush(offlineSend, isPermanent);
    expect(r1.ok).toBe(false); // transient stop
    expect(r1.sent).toBe(0);
    expect(outbox1.pendingCount()).toBe(1);
    expect(store.snapshot()).toHaveLength(1); // still durably queued

    // Session 2 — simulate an app RELAUNCH: a fresh outbox on the SAME store restores the queued approval…
    const outbox2 = new WeighOutbox(store);
    await outbox2.init();
    expect(outbox2.pendingCount()).toBe(1); // durability: survived the relaunch

    // …and now ONLINE it syncs, reusing the SAME idempotency key (de-duped server-side).
    let sentKey: string | undefined;
    const onlineSend = jest.fn(async (i: WeighQueueItem) => {
      sentKey = i.idempotencyKey;
      return okResult('7.20');
    });
    const r2 = await outbox2.flush(onlineSend, isPermanent);
    expect(r2.sent).toBe(1);
    expect(sentKey).toBe('key-off'); // key reused on retry → no double-capture
    expect(outbox2.pendingCount()).toBe(0);
    expect(store.snapshot()).toHaveLength(0);
  });

  it('a permanent (4xx) rejection is marked failed and NOT retried', async () => {
    const store = new MemoryWeighOutboxStore();
    const outbox = new WeighOutbox(store);
    await outbox.init();
    await outbox.enqueue(input(), 'key-1');
    const send = jest.fn(async () => {
      throw new Permanent('stop no longer active');
    });
    const res = await outbox.flush(send, isPermanent);
    expect(res.failed).toBe(1);
    expect(res.remaining).toBe(0);
    expect(outbox.pendingCount()).toBe(0); // not queued for retry
    expect(store.snapshot()[0]!.status).toBe('failed');
    // a second flush does NOT re-send the failed item
    await outbox.flush(send, isPermanent);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('re-weigh is a NEW immutable capture: a fresh enqueue with a new key (never edits the old)', async () => {
    const store = new MemoryWeighOutboxStore();
    const outbox = new WeighOutbox(store);
    await outbox.init();
    const a = await outbox.enqueue(input({ weightKg: 6 }), 'key-a');
    await outbox.flush(jest.fn(async () => okResult('6.00')), isPermanent);
    const b = await outbox.enqueue(input({ weightKg: 8 }), 'key-b');
    expect(b.id).not.toBe(a.id);
    expect(b.idempotencyKey).toBe('key-b'); // distinct key → a new server capture
    expect(b.weightKg).toBe(8);
  });

  it('flush order is FIFO and a transient stop halts the batch (in-order delivery)', async () => {
    const store = new MemoryWeighOutboxStore();
    const outbox = new WeighOutbox(store);
    await outbox.init();
    await outbox.enqueue(input({ weightKg: 1 }), 'k1');
    await outbox.enqueue(input({ weightKg: 2 }), 'k2');
    const send = jest.fn(async (i: WeighQueueItem) => {
      if (i.weightKg === 2) throw new Offline('drop');
      return okResult('1.00');
    });
    const res = await outbox.flush(send, isPermanent);
    expect(res.sent).toBe(1); // k1 confirmed, k2 transient → stop
    expect(res.remaining).toBe(1);
    expect(outbox.list().map((i) => i.idempotencyKey)).toEqual(['k2']);
  });
});
