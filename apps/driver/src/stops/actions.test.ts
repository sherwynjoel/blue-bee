import { RouteStopStatus } from '@blue-bee/shared';
import { availableActions, isTerminal, reasonsFor, requiresReason } from './actions';

describe('§5.4 stop-action helpers', () => {
  it('derives the legal next actions from the shared graph', () => {
    expect(availableActions(RouteStopStatus.PENDING)).toEqual(['depart', 'skip']);
    expect(availableActions(RouteStopStatus.EN_ROUTE)).toEqual(['arrive', 'fail', 'skip']);
    expect(availableActions(RouteStopStatus.ARRIVED)).toEqual(['start', 'fail']);
    expect(availableActions(RouteStopStatus.IN_PROGRESS)).toEqual(['complete', 'fail']);
    expect(availableActions(RouteStopStatus.COMPLETED)).toEqual([]);
  });

  it('marks terminal statuses', () => {
    expect(isTerminal(RouteStopStatus.COMPLETED)).toBe(true);
    expect(isTerminal(RouteStopStatus.FAILED)).toBe(true);
    expect(isTerminal(RouteStopStatus.SKIPPED)).toBe(true);
    expect(isTerminal(RouteStopStatus.EN_ROUTE)).toBe(false);
  });

  it('requires a reason only for fail/skip and offers reason codes', () => {
    expect(requiresReason('fail')).toBe(true);
    expect(requiresReason('skip')).toBe(true);
    expect(requiresReason('arrive')).toBe(false);
    expect(reasonsFor('fail')).toContain('customer_unavailable');
    expect(reasonsFor('skip')).toContain('rescheduled');
  });
});
