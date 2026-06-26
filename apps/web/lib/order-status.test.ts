import { OrderStatus } from '@blue-bee/shared';
import { buildTimeline, statusLabel } from './order-status';

describe('order-status (pure, from server state)', () => {
  it('marks done/current/upcoming around the server status', () => {
    const t = buildTimeline(OrderStatus.QUOTED);
    const current = t.find((s) => s.state === 'current');
    expect(current?.status).toBe(OrderStatus.QUOTED);
    // REQUESTED (earlier) is done; IN_CLEANING (later) is upcoming.
    expect(t.find((s) => s.status === OrderStatus.REQUESTED)?.state).toBe('done');
    expect(t.find((s) => s.status === OrderStatus.IN_CLEANING)?.state).toBe('upcoming');
  });

  it('anchors a branch state (DAMAGE_PREEXISTING_FLAGGED) to the inspection milestone', () => {
    const t = buildTimeline(OrderStatus.DAMAGE_PREEXISTING_FLAGGED);
    expect(t.find((s) => s.status === OrderStatus.INTAKE_INSPECTED)?.state).toBe('current');
  });

  it('ON_HOLD anchors to heldFrom', () => {
    const t = buildTimeline(OrderStatus.ON_HOLD, OrderStatus.IN_CLEANING);
    expect(t.find((s) => s.status === OrderStatus.IN_CLEANING)?.state).toBe('current');
  });

  it('labels every status', () => {
    for (const s of Object.values(OrderStatus)) {
      expect(statusLabel(s).length).toBeGreaterThan(0);
    }
  });
});
