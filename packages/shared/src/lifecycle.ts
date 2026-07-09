/**
 * Lifecycle transition maps — the executable form of the PRD §5 state machines.
 *
 * Used server-side to reject illegal status changes and (in this increment) by
 * the seed to assert that the demo order walks a LEGAL path. This is real domain
 * logic, not a stub: `canTransitionOrder` / `canTransitionStop` enforce §5.
 */
import { OrderStatus, RouteStopStatus } from './enums';

/** Terminal specialty states — no outbound transitions. */
export const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CLOSED,
  OrderStatus.CLOSED_NO_WORK,
]);

/**
 * Allowed next states for the specialty job lifecycle (PRD §5.1), EXCLUDING the
 * `ON_HOLD` wildcard which is handled in `canTransitionOrder` ("any → ON_HOLD →
 * resumes"). Each entry is verbatim from the §5.1 spine + branches.
 */
export const SPECIALTY_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.REQUESTED]: [OrderStatus.SCHEDULED_PICKUP],
  [OrderStatus.SCHEDULED_PICKUP]: [OrderStatus.PICKUP_EN_ROUTE],
  [OrderStatus.PICKUP_EN_ROUTE]: [OrderStatus.PICKED_UP],
  [OrderStatus.PICKED_UP]: [OrderStatus.INTAKE_INSPECTED],
  [OrderStatus.INTAKE_INSPECTED]: [OrderStatus.QUOTED, OrderStatus.DAMAGE_PREEXISTING_FLAGGED],
  // Pre-existing damage is acknowledged, then the job continues to quoting (§5.1).
  [OrderStatus.DAMAGE_PREEXISTING_FLAGGED]: [OrderStatus.QUOTED],
  [OrderStatus.QUOTED]: [OrderStatus.QUOTE_APPROVED, OrderStatus.QUOTE_DECLINED],
  // [Inc-23 §5.1 branch] RE-QUOTE on a plant re-weigh / re-measure BEFORE cleaning starts: an approved
  // quote may re-open (→ QUOTED) when the authoritative measure changes. A FIXED line re-prices at the
  // published rate and auto-re-approves; a FROM_MEASURED line re-opens for customer re-approval. This is a
  // pre-cleaning correction only (QUOTE_APPROVED still leads forward to IN_CLEANING when work begins).
  [OrderStatus.QUOTE_APPROVED]: [OrderStatus.IN_CLEANING, OrderStatus.QUOTED],
  [OrderStatus.QUOTE_DECLINED]: [OrderStatus.CLOSED_NO_WORK],
  [OrderStatus.IN_CLEANING]: [OrderStatus.QC, OrderStatus.REWASH],
  [OrderStatus.REWASH]: [OrderStatus.IN_CLEANING],
  [OrderStatus.QC]: [OrderStatus.READY, OrderStatus.REWASH],
  [OrderStatus.READY]: [OrderStatus.SCHEDULED_DELIVERY],
  [OrderStatus.SCHEDULED_DELIVERY]: [OrderStatus.DELIVERY_EN_ROUTE],
  [OrderStatus.DELIVERY_EN_ROUTE]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.INVOICED, OrderStatus.CLAIM_OPENED],
  [OrderStatus.CLAIM_OPENED]: [OrderStatus.CLAIM_RESOLVED],
  [OrderStatus.CLAIM_RESOLVED]: [OrderStatus.INVOICED, OrderStatus.CLOSED],
  [OrderStatus.INVOICED]: [OrderStatus.CLOSED],
  [OrderStatus.CLOSED]: [],
  [OrderStatus.CLOSED_NO_WORK]: [],
  // ON_HOLD outbound edges are computed (resume to any active state) — see below.
  [OrderStatus.ON_HOLD]: [],
};

/**
 * `true` if `to` is a legal next state for a specialty order in state `from`.
 *
 * Encodes the §5.1 "any → ON_HOLD (reason) → resumes" wildcard: any non-terminal
 * state may go ON_HOLD. For the resume, "resumes" means returning to the state the
 * order was paused in (or stepping forward from it) — not teleporting anywhere. So
 * when the paused-from state is known, pass it as `heldFrom` and the resume is
 * constrained to `heldFrom` or its legal successors. The orders module (later
 * increment) will persist `heldFrom` on the Order and always pass it. When it is
 * omitted (e.g. unit checks), we fall back to "any non-terminal" — intentionally
 * permissive, and the only place the §5.1 spine is not fully enforced.
 */
export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  heldFrom?: OrderStatus,
): boolean {
  if (from === to) return false;
  if (TERMINAL_ORDER_STATUSES.has(from)) return false;
  if (to === OrderStatus.ON_HOLD) return true; // any active → ON_HOLD
  if (from === OrderStatus.ON_HOLD) {
    if (TERMINAL_ORDER_STATUSES.has(to)) return false;
    if (heldFrom !== undefined) {
      // Resume only to the paused state or a state legally reachable from it.
      return to === heldFrom || SPECIALTY_ORDER_TRANSITIONS[heldFrom].includes(to);
    }
    return true; // permissive fallback (see doc comment)
  }
  return SPECIALTY_ORDER_TRANSITIONS[from].includes(to);
}

/** Allowed next states for a RouteStop (PRD §5.4). */
export const ROUTE_STOP_TRANSITIONS: Readonly<Record<RouteStopStatus, readonly RouteStopStatus[]>> = {
  [RouteStopStatus.PENDING]: [RouteStopStatus.EN_ROUTE, RouteStopStatus.SKIPPED],
  [RouteStopStatus.EN_ROUTE]: [RouteStopStatus.ARRIVED, RouteStopStatus.FAILED, RouteStopStatus.SKIPPED],
  [RouteStopStatus.ARRIVED]: [RouteStopStatus.IN_PROGRESS, RouteStopStatus.FAILED],
  [RouteStopStatus.IN_PROGRESS]: [RouteStopStatus.COMPLETED, RouteStopStatus.FAILED],
  [RouteStopStatus.COMPLETED]: [],
  [RouteStopStatus.FAILED]: [],
  [RouteStopStatus.SKIPPED]: [],
};

/** `true` if `to` is a legal next state for a RouteStop in state `from` (§5.4). */
export function canTransitionStop(from: RouteStopStatus, to: RouteStopStatus): boolean {
  if (from === to) return false;
  return ROUTE_STOP_TRANSITIONS[from].includes(to);
}
