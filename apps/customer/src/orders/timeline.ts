import { OrderStatus } from '@blue-bee/shared';

/**
 * The §5.1 specialty lifecycle, rendered for the customer FROM SERVER STATE (`order.status`) — never
 * invented client-side. We map the server's status onto the canonical PRD §5.1 spine to show "where
 * your order is"; branch/terminal states (declined, damage-flagged, on-hold, claim) anchor to their
 * spine position and add an honest note. Pure → unit-tested.
 */

/** Customer-facing milestone spine (the §5.1 happy path), in order. */
export const TIMELINE_SPINE: OrderStatus[] = [
  OrderStatus.REQUESTED,
  OrderStatus.SCHEDULED_PICKUP,
  OrderStatus.PICKUP_EN_ROUTE,
  OrderStatus.PICKED_UP,
  OrderStatus.INTAKE_INSPECTED,
  OrderStatus.QUOTED,
  OrderStatus.QUOTE_APPROVED,
  OrderStatus.IN_CLEANING,
  OrderStatus.QC,
  OrderStatus.READY,
  OrderStatus.SCHEDULED_DELIVERY,
  OrderStatus.DELIVERY_EN_ROUTE,
  OrderStatus.DELIVERED,
  OrderStatus.INVOICED,
  OrderStatus.CLOSED,
];

const SPINE_LABELS: Record<string, string> = {
  [OrderStatus.REQUESTED]: 'Requested',
  [OrderStatus.SCHEDULED_PICKUP]: 'Pickup scheduled',
  [OrderStatus.PICKUP_EN_ROUTE]: 'Pickup en route',
  [OrderStatus.PICKED_UP]: 'Picked up',
  [OrderStatus.INTAKE_INSPECTED]: 'Inspected at plant',
  [OrderStatus.QUOTED]: 'Quote ready',
  [OrderStatus.QUOTE_APPROVED]: 'Quote approved',
  [OrderStatus.IN_CLEANING]: 'In cleaning',
  [OrderStatus.QC]: 'Quality check',
  [OrderStatus.READY]: 'Ready',
  [OrderStatus.SCHEDULED_DELIVERY]: 'Delivery scheduled',
  [OrderStatus.DELIVERY_EN_ROUTE]: 'Out for delivery',
  [OrderStatus.DELIVERED]: 'Delivered',
  [OrderStatus.INVOICED]: 'Invoiced',
  [OrderStatus.CLOSED]: 'Closed',
};

/** Where each status sits on the spine (branch states anchor to the nearest milestone). */
const STAGE_INDEX: Record<string, number> = {
  [OrderStatus.REQUESTED]: 0,
  [OrderStatus.SCHEDULED_PICKUP]: 1,
  [OrderStatus.PICKUP_EN_ROUTE]: 2,
  [OrderStatus.PICKED_UP]: 3,
  [OrderStatus.INTAKE_INSPECTED]: 4,
  [OrderStatus.DAMAGE_PREEXISTING_FLAGGED]: 4,
  [OrderStatus.QUOTED]: 5,
  [OrderStatus.QUOTE_APPROVED]: 6,
  [OrderStatus.QUOTE_DECLINED]: 5,
  [OrderStatus.IN_CLEANING]: 7,
  [OrderStatus.REWASH]: 7,
  [OrderStatus.QC]: 8,
  [OrderStatus.READY]: 9,
  [OrderStatus.SCHEDULED_DELIVERY]: 10,
  [OrderStatus.DELIVERY_EN_ROUTE]: 11,
  [OrderStatus.DELIVERED]: 12,
  [OrderStatus.CLAIM_OPENED]: 12,
  [OrderStatus.CLAIM_RESOLVED]: 12,
  [OrderStatus.INVOICED]: 13,
  [OrderStatus.CLOSED]: 14,
  [OrderStatus.CLOSED_NO_WORK]: 14,
};

/** An honest note for the non-spine (branch/terminal/hold) states. */
const BRANCH_NOTES: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.DAMAGE_PREEXISTING_FLAGGED]: 'Pre-existing damage was flagged at intake — please review it below.',
  [OrderStatus.QUOTE_DECLINED]: 'You declined this quote.',
  [OrderStatus.CLOSED_NO_WORK]: 'Closed — no work was performed.',
  [OrderStatus.ON_HOLD]: 'This order is on hold. We’ll be in touch.',
  [OrderStatus.REWASH]: 'Being re-cleaned to meet our quality bar.',
  [OrderStatus.CLAIM_OPENED]: 'A claim has been opened on this order.',
  [OrderStatus.CLAIM_RESOLVED]: 'The claim on this order has been resolved.',
};

export type StepState = 'done' | 'current' | 'upcoming';

export interface TimelineStep {
  status: OrderStatus;
  label: string;
  state: StepState;
}

export interface Timeline {
  steps: TimelineStep[];
  /** A note for branch/hold/terminal states (e.g. declined, damage flagged), else null. */
  note: string | null;
  /** True when the order ended without the happy path (declined / closed-no-work). */
  terminatedEarly: boolean;
}

function labelFor(status: OrderStatus): string {
  return SPINE_LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase();
}

/**
 * Build the customer timeline from the server status (and `heldFrom` for ON_HOLD). Steps earlier than
 * the current anchor are `done`, the anchor is `current`, later are `upcoming`.
 */
export function buildTimeline(status: OrderStatus, heldFrom?: OrderStatus | null): Timeline {
  const effective = status === OrderStatus.ON_HOLD && heldFrom ? heldFrom : status;
  const anchor = STAGE_INDEX[effective] ?? 0;
  const terminatedEarly = status === OrderStatus.QUOTE_DECLINED || status === OrderStatus.CLOSED_NO_WORK;

  const steps: TimelineStep[] = TIMELINE_SPINE.map((s, i) => {
    const state: StepState = i < anchor ? 'done' : i === anchor ? 'current' : 'upcoming';
    return { status: s, label: labelFor(s), state };
  });

  return { steps, note: BRANCH_NOTES[status] ?? null, terminatedEarly };
}

/** A short customer-facing label for any status (used in list rows + headers). */
export function statusLabel(status: OrderStatus): string {
  if (SPINE_LABELS[status]) return SPINE_LABELS[status]!;
  switch (status) {
    case OrderStatus.DAMAGE_PREEXISTING_FLAGGED:
      return 'Damage flagged';
    case OrderStatus.QUOTE_DECLINED:
      return 'Quote declined';
    case OrderStatus.CLOSED_NO_WORK:
      return 'Closed (no work)';
    case OrderStatus.ON_HOLD:
      return 'On hold';
    case OrderStatus.REWASH:
      return 'Re-cleaning';
    case OrderStatus.CLAIM_OPENED:
      return 'Claim opened';
    case OrderStatus.CLAIM_RESOLVED:
      return 'Claim resolved';
    default:
      return status.replace(/_/g, ' ').toLowerCase();
  }
}
