import { RouteStopStatus, canTransitionStop, type DriverStopAction } from '@blue-bee/shared';

/**
 * §5.4 stop-action helpers for the UI. The available actions are derived from the SHARED
 * `canTransitionStop` graph (the single source of truth the server also enforces) — so the buttons
 * a driver sees are exactly the legal next transitions, and the server's 409 on an illegal one is a
 * race tiebreak, not a surprise.
 */

/** Each driver action maps to its §5.4 target status. */
export const ACTION_TARGET: Record<DriverStopAction, RouteStopStatus> = {
  depart: RouteStopStatus.EN_ROUTE,
  arrive: RouteStopStatus.ARRIVED,
  start: RouteStopStatus.IN_PROGRESS,
  complete: RouteStopStatus.COMPLETED,
  fail: RouteStopStatus.FAILED,
  skip: RouteStopStatus.SKIPPED,
};

export const ACTION_LABEL: Record<DriverStopAction, string> = {
  depart: 'Depart for stop',
  arrive: "I've arrived",
  start: 'Start work',
  complete: 'Complete stop',
  fail: 'Mark failed',
  skip: 'Skip stop',
};

/** The legal next actions from a given status (per the shared §5.4 graph). */
export function availableActions(status: string): DriverStopAction[] {
  const from = status as RouteStopStatus;
  return (Object.keys(ACTION_TARGET) as DriverStopAction[]).filter((a) => canTransitionStop(from, ACTION_TARGET[a]));
}

export function isTerminal(status: string): boolean {
  return (
    status === RouteStopStatus.COMPLETED || status === RouteStopStatus.FAILED || status === RouteStopStatus.SKIPPED
  );
}

/** fail / skip require a reason code (the §5.4 exception contract). */
export function requiresReason(action: DriverStopAction): boolean {
  return action === 'fail' || action === 'skip';
}

/** Suggested reason codes (the driver picks one; free text allowed server-side). */
export const FAIL_REASONS = ['customer_unavailable', 'access_blocked', 'address_not_found', 'vehicle_issue', 'other'] as const;
export const SKIP_REASONS = ['rescheduled', 'customer_request', 'out_of_time', 'other'] as const;

export function reasonsFor(action: DriverStopAction): readonly string[] {
  return action === 'fail' ? FAIL_REASONS : SKIP_REASONS;
}
