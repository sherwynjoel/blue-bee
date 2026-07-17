import { OrderStatus } from '@blue-bee/shared';
import { buildTimeline, statusLabel, customerStatus, buildCustomerTimeline } from './timeline';

describe('buildTimeline (§5.1 rendered from server state)', () => {
  it('marks the current status current, earlier done, later upcoming', () => {
    const { steps } = buildTimeline(OrderStatus.QUOTED);
    const byStatus = Object.fromEntries(steps.map((s) => [s.status, s.state]));
    expect(byStatus[OrderStatus.REQUESTED]).toBe('done');
    expect(byStatus[OrderStatus.PICKED_UP]).toBe('done');
    expect(byStatus[OrderStatus.QUOTED]).toBe('current');
    expect(byStatus[OrderStatus.IN_CLEANING]).toBe('upcoming');
    expect(byStatus[OrderStatus.DELIVERED]).toBe('upcoming');
  });

  it('the first status (REQUESTED) is current with everything ahead upcoming', () => {
    const { steps } = buildTimeline(OrderStatus.REQUESTED);
    expect(steps[0]!.state).toBe('current');
    expect(steps.slice(1).every((s) => s.state === 'upcoming')).toBe(true);
  });

  it('DAMAGE_PREEXISTING_FLAGGED anchors at inspected + surfaces a note', () => {
    const t = buildTimeline(OrderStatus.DAMAGE_PREEXISTING_FLAGGED);
    const byStatus = Object.fromEntries(t.steps.map((s) => [s.status, s.state]));
    expect(byStatus[OrderStatus.INTAKE_INSPECTED]).toBe('current');
    expect(t.note).toMatch(/pre-existing damage/i);
  });

  it('QUOTE_DECLINED is terminatedEarly with a note', () => {
    const t = buildTimeline(OrderStatus.QUOTE_DECLINED);
    expect(t.terminatedEarly).toBe(true);
    expect(t.note).toMatch(/declined/i);
  });

  it('ON_HOLD anchors at the held-from state', () => {
    const t = buildTimeline(OrderStatus.ON_HOLD, OrderStatus.IN_CLEANING);
    const byStatus = Object.fromEntries(t.steps.map((s) => [s.status, s.state]));
    expect(byStatus[OrderStatus.IN_CLEANING]).toBe('current');
    expect(t.note).toMatch(/on hold/i);
  });

  it('statusLabel gives friendly labels for branch states', () => {
    expect(statusLabel(OrderStatus.QUOTED)).toBe('Quote ready');
    expect(statusLabel(OrderStatus.DAMAGE_PREEXISTING_FLAGGED)).toBe('Damage flagged');
    expect(statusLabel(OrderStatus.CLOSED_NO_WORK)).toBe('Closed (no work)');
  });
});

describe('customerStatus — the 4-stage customer collapse (never leaks internal statuses)', () => {
  it('collapses every internal plant status into one of the 4 customer stages', () => {
    // stage 0 (placed) — awaiting/scheduled pickup
    expect(customerStatus(OrderStatus.REQUESTED).stageIndex).toBe(0);
    expect(customerStatus(OrderStatus.SCHEDULED_PICKUP).label).toBe('Pickup scheduled');
    // stage 1 (picked up) — every plant/processing status folds here
    for (const s of [OrderStatus.PICKED_UP, OrderStatus.INTAKE_INSPECTED, OrderStatus.QUOTED, OrderStatus.QUOTE_APPROVED, OrderStatus.IN_CLEANING, OrderStatus.QC, OrderStatus.READY]) {
      expect(customerStatus(s).stageIndex).toBe(1);
      expect(customerStatus(s).label).toBe('Picked up'); // the internal name never shows
    }
    // stage 2 (out for delivery) — orange
    expect(customerStatus(OrderStatus.DELIVERY_EN_ROUTE)).toMatchObject({ stageIndex: 2, label: 'Out for delivery', tone: 'transit' });
    // stage 3 (delivered) — green
    expect(customerStatus(OrderStatus.DELIVERED)).toMatchObject({ stageIndex: 3, label: 'Delivered', tone: 'delivered' });
    expect(customerStatus(OrderStatus.INVOICED).stageIndex).toBe(3);
  });

  it('on-hold anchors at its held-from stage and stays honest', () => {
    const v = customerStatus(OrderStatus.ON_HOLD, OrderStatus.IN_CLEANING);
    expect(v).toMatchObject({ stageIndex: 1, label: 'On hold', tone: 'hold', onHold: true });
    expect(v.note).toMatch(/on hold/i);
  });

  it('declined / no-work end early with no tracker stage', () => {
    expect(customerStatus(OrderStatus.QUOTE_DECLINED)).toMatchObject({ stageIndex: null, terminatedEarly: true });
    expect(customerStatus(OrderStatus.CLOSED_NO_WORK)).toMatchObject({ stageIndex: null, terminatedEarly: true });
  });

  it('buildCustomerTimeline is always 4 nodes with done/current/upcoming', () => {
    const t = buildCustomerTimeline(OrderStatus.DELIVERY_EN_ROUTE);
    expect(t.steps.map((s) => s.label)).toEqual(['Order placed', 'Picked up', 'Out for delivery', 'Delivered']);
    expect(t.steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming']);
  });
});
