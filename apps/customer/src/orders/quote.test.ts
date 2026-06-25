import { OrderStatus, QuoteStatus } from '@blue-bee/shared';
import type { OrderDetail } from '../api/types';
import { hasActiveStop, preexistingDamageItems, quoteActionability } from './quote';

function order(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    orgId: 'org',
    accountId: 'acc',
    siteId: null,
    vertical: 'SPECIALTY',
    type: 'JOB',
    status: OrderStatus.QUOTED,
    heldFrom: null,
    scheduledPickupWindow: null,
    scheduledDeliveryWindow: null,
    totals: null,
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z',
    items: [],
    quotes: [],
    routeStops: [],
    ...over,
  };
}

function quote(over: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    status: QuoteStatus.SENT,
    subtotal: '100.00',
    tax: '13.00',
    total: '113.00',
    lines: [],
    adjustments: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-06-25T00:00:00.000Z',
    ...over,
  };
}

describe('quoteActionability', () => {
  it('is actionable when QUOTED with a SENT quote', () => {
    const qa = quoteActionability(order({ quotes: [quote()] }));
    expect(qa.actionable).toBe(true);
    expect(qa.expired).toBe(false);
    expect(qa.approved).toBe(false);
  });

  it('flags an expired SENT quote (client hint; server stays authority)', () => {
    const qa = quoteActionability(order({ quotes: [quote({ expiresAt: '2000-01-01T00:00:00.000Z' })] }), Date.parse('2026-06-25'));
    expect(qa.actionable).toBe(true);
    expect(qa.expired).toBe(true);
  });

  it('reports approved when the order moved to QUOTE_APPROVED', () => {
    const qa = quoteActionability(order({ status: OrderStatus.QUOTE_APPROVED, quotes: [quote({ status: QuoteStatus.APPROVED })] }));
    expect(qa.actionable).toBe(false);
    expect(qa.approved).toBe(true);
  });

  it('reports declined for CLOSED_NO_WORK', () => {
    const qa = quoteActionability(order({ status: OrderStatus.CLOSED_NO_WORK, quotes: [quote({ status: QuoteStatus.DECLINED })] }));
    expect(qa.declined).toBe(true);
    expect(qa.actionable).toBe(false);
  });
});

describe('preexistingDamageItems + hasActiveStop', () => {
  it('finds items with a pre-existing-damage inspection', () => {
    const o = order({
      items: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'i1', kind: 'RUG', status: 'INSPECTED', measurements: {}, inspections: [{ id: 'x', preexistingDamage: true, conditionCodes: [], notes: null, ackBy: 'u', ackAt: '2026-06-25', createdAt: '2026-06-25' }], photos: [], custodyEvents: [] } as any,
      ],
    });
    expect(preexistingDamageItems(o)).toHaveLength(1);
  });

  it('hasActiveStop is true only for non-terminal route stops', () => {
    expect(hasActiveStop(order({ routeStops: [{ id: 's', kind: 'PICKUP', seq: 1, status: 'EN_ROUTE', eta: null, arrivedAt: null, completedAt: null, routeId: 'r' }] }))).toBe(true);
    expect(hasActiveStop(order({ routeStops: [{ id: 's', kind: 'PICKUP', seq: 1, status: 'COMPLETED', eta: null, arrivedAt: null, completedAt: null, routeId: 'r' }] }))).toBe(false);
    expect(hasActiveStop(order({ routeStops: [] }))).toBe(false);
  });
});
