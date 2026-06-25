import { ItemKind } from '@blue-bee/shared';
import { buildBookDto, newIdempotencyKey, tomorrowMorningWindow } from './booking';

describe('booking helpers', () => {
  it('maps the form to a BookOrderDto, dropping empty optionals', () => {
    const dto = buildBookDto({
      accountId: 'acc-1',
      items: [{ kind: ItemKind.RUG, serviceId: 'svc-1', estimatedMeasure: 40 }],
    });
    expect(dto).toEqual({
      accountId: 'acc-1',
      items: [{ kind: ItemKind.RUG, serviceId: 'svc-1', estimatedMeasure: 40 }],
    });
    expect('siteId' in dto).toBe(false);
    expect('pickupWindow' in dto).toBe(false);
  });

  it('includes siteId + pickupWindow + notes when present, and omits a zero measure', () => {
    const pickupWindow = { start: '2026-07-01T13:00:00.000Z', end: '2026-07-01T16:00:00.000Z' };
    const dto = buildBookDto({
      accountId: 'acc-1',
      siteId: 'site-1',
      pickupWindow,
      notes: 'ring the bell',
      items: [{ kind: ItemKind.CARPET, serviceId: 'svc-1', estimatedMeasure: 0 }],
    });
    expect(dto.siteId).toBe('site-1');
    expect(dto.pickupWindow).toEqual(pickupWindow);
    expect(dto.notes).toBe('ring the bell');
    expect('estimatedMeasure' in dto.items[0]!).toBe(false); // 0 measure dropped
  });

  it('throws when there are no items', () => {
    expect(() => buildBookDto({ accountId: 'acc-1', items: [] })).toThrow(/at least one item/i);
  });

  it('newIdempotencyKey is deterministic given injected rand/now and varies otherwise', () => {
    const k1 = newIdempotencyKey(() => 0.5, () => 1000);
    const k2 = newIdempotencyKey(() => 0.5, () => 1000);
    expect(k1).toBe(k2); // same inputs → same key (so a retry de-dupes)
    const k3 = newIdempotencyKey(() => 0.9, () => 2000);
    expect(k3).not.toBe(k1);
    expect(k1.startsWith('book-')).toBe(true);
  });

  it('tomorrowMorningWindow is the next day 09:00–12:00 local', () => {
    const base = new Date('2026-06-25T20:00:00.000Z').getTime();
    const w = tomorrowMorningWindow(() => base);
    const start = new Date(w.start);
    const end = new Date(w.end);
    expect(start.getHours()).toBe(9);
    expect(end.getHours()).toBe(12);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});
