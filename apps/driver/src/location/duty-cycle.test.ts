import { DUTY_CYCLE, LocationOutbox, pickIntervalMs, toPing } from './duty-cycle';
import type { GpsPingDto } from '@blue-bee/shared';

describe('toPing', () => {
  it('normalizes a fix and drops unknown (-1) sensor fields', () => {
    const p = toPing({ latitude: 43.7, longitude: -79.4, speed: -1, heading: -1, timestampMs: 1_700_000_000_000 });
    expect(p).toEqual({ lat: 43.7, lng: -79.4, recordedAt: new Date(1_700_000_000_000).toISOString() });
    expect(p.speed).toBeUndefined();
    expect(p.heading).toBeUndefined();
  });

  it('keeps valid speed/heading and clamps speed', () => {
    const p = toPing({ latitude: 1, longitude: 2, speed: 12.5, heading: 180, timestampMs: 1_700_000_000_000 });
    expect(p.speed).toBe(12.5);
    expect(p.heading).toBe(180);
    const fast = toPing({ latitude: 1, longitude: 2, speed: 5000, heading: 400, timestampMs: 1 });
    expect(fast.speed).toBe(1000); // clamped to the schema max
    expect(fast.heading).toBeUndefined(); // 400 out of [0,360] → dropped
  });
});

describe('pickIntervalMs', () => {
  it('uses the tight cadence near a stop and the loose one far away', () => {
    expect(pickIntervalMs(500)).toBe(DUTY_CYCLE.approachingIntervalMs);
    expect(pickIntervalMs(50_000)).toBe(DUTY_CYCLE.highwayIntervalMs);
    expect(pickIntervalMs(null)).toBe(DUTY_CYCLE.highwayIntervalMs);
  });
});

describe('LocationOutbox', () => {
  const ping = (sec: number): GpsPingDto => ({ lat: 1, lng: 2, recordedAt: new Date(sec * 1000).toISOString() });

  it('dedupes by recordedAt and keeps chronological order', () => {
    const box = new LocationOutbox();
    box.enqueue([ping(3), ping(1), ping(2)]);
    box.enqueue([ping(2)]); // duplicate instant
    expect(box.size).toBe(3);
    expect(box.peek().map((p) => p.recordedAt)).toEqual([ping(1), ping(2), ping(3)].map((p) => p.recordedAt));
  });

  it('caps at the max, dropping the oldest and counting the drops', () => {
    const box = new LocationOutbox(2, 10); // cap 2
    box.enqueue([ping(1), ping(2), ping(3)]);
    expect(box.size).toBe(2);
    expect(box.droppedCount).toBe(1);
    expect(box.peek().map((p) => p.recordedAt)).toEqual([ping(2), ping(3)].map((p) => p.recordedAt)); // freshest kept
  });

  it('flush() drains on success, in batches', async () => {
    const box = new LocationOutbox(1000, 2); // maxBatch 2
    box.enqueue([ping(1), ping(2), ping(3)]);
    const sent: number[] = [];
    const res = await box.flush(async (batch) => sent.push(batch.length));
    expect(res).toEqual({ sent: 3, remaining: 0, ok: true });
    expect(sent).toEqual([2, 1]); // two batches: 2 then 1
    expect(box.size).toBe(0);
  });

  it('flush() keeps pings queued on a network failure (idempotent retry)', async () => {
    const box = new LocationOutbox();
    box.enqueue([ping(1), ping(2)]);
    const res = await box.flush(async () => {
      throw new Error('network down');
    });
    expect(res.ok).toBe(false);
    expect(res.sent).toBe(0);
    expect(res.remaining).toBe(2);
    expect(box.size).toBe(2); // still buffered → next flush retries (server ON CONFLICT dedupes)

    // a later successful flush drains them
    const ok = await box.flush(async () => undefined);
    expect(ok).toEqual({ sent: 2, remaining: 0, ok: true });
    expect(box.size).toBe(0);
  });
});
