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

// ─────────────────────── Customer-facing 4-stage collapse (Royal redesign) ───────────────────────
// The customer must NOT see the internal plant statuses (scheduled/dry pickup, inspect-at-plant, quote
// ready/approved, in-cleaning, QC…). Per the reference design, the customer's order tracker has exactly
// FOUR stages: Order placed → Picked up → Out for delivery → Delivered. We collapse the server's granular
// OrderStatus onto those four (with honest handling for on-hold / declined / no-work). Presentation only —
// the status still comes from `order.status`, never invented. Use this everywhere the customer sees status;
// `buildTimeline`/the 15-node spine above stays for any internal/ops surface that wants the full detail.

export type CustomerStageIndex = 0 | 1 | 2 | 3;
export const CUSTOMER_STAGE_LABELS = ['Order placed', 'Picked up', 'Out for delivery', 'Delivered'] as const;
/** Tone key the customer status maps to (screen maps this to a Badge/IconBadge tone + timeline colour). */
export type CustomerTone = 'active' | 'transit' | 'delivered' | 'exception' | 'hold';

const CUSTOMER_STAGE_OF: Record<string, CustomerStageIndex> = {
  [OrderStatus.REQUESTED]: 0,
  [OrderStatus.SCHEDULED_PICKUP]: 0,
  [OrderStatus.PICKUP_EN_ROUTE]: 0,
  [OrderStatus.PICKED_UP]: 1,
  [OrderStatus.INTAKE_INSPECTED]: 1,
  [OrderStatus.DAMAGE_PREEXISTING_FLAGGED]: 1,
  [OrderStatus.QUOTED]: 1,
  [OrderStatus.QUOTE_APPROVED]: 1,
  [OrderStatus.IN_CLEANING]: 1,
  [OrderStatus.REWASH]: 1,
  [OrderStatus.QC]: 1,
  [OrderStatus.READY]: 1,
  [OrderStatus.SCHEDULED_DELIVERY]: 2,
  [OrderStatus.DELIVERY_EN_ROUTE]: 2,
  [OrderStatus.DELIVERED]: 3,
  [OrderStatus.INVOICED]: 3,
  [OrderStatus.CLOSED]: 3,
  [OrderStatus.CLAIM_OPENED]: 3,
  [OrderStatus.CLAIM_RESOLVED]: 3,
};

export interface CustomerStatusView {
  /** 0-3 stage for the 4-node tracker; null when the order ended early (declined / no work → no tracker). */
  stageIndex: CustomerStageIndex | null;
  /** The single pill label the customer sees (e.g. "Pickup scheduled", "Out for delivery"). */
  label: string;
  tone: CustomerTone;
  onHold: boolean;
  /** Honest note for exception/hold states, else null. */
  note: string | null;
  terminatedEarly: boolean;
}

function customerPillLabel(status: OrderStatus, stage: CustomerStageIndex): string {
  if (status === OrderStatus.SCHEDULED_PICKUP) return 'Pickup scheduled';
  if (status === OrderStatus.PICKUP_EN_ROUTE) return 'Pickup en route';
  return CUSTOMER_STAGE_LABELS[stage];
}

/** Collapse a server OrderStatus (+ heldFrom for ON_HOLD) into the customer's 4-stage view. */
export function customerStatus(status: OrderStatus, heldFrom?: OrderStatus | null): CustomerStatusView {
  if (status === OrderStatus.QUOTE_DECLINED)
    return { stageIndex: null, label: 'Quote declined', tone: 'exception', onHold: false, note: BRANCH_NOTES[OrderStatus.QUOTE_DECLINED] ?? null, terminatedEarly: true };
  if (status === OrderStatus.CLOSED_NO_WORK)
    return { stageIndex: null, label: 'Closed', tone: 'exception', onHold: false, note: BRANCH_NOTES[OrderStatus.CLOSED_NO_WORK] ?? null, terminatedEarly: true };

  const onHold = status === OrderStatus.ON_HOLD;
  const effective = onHold && heldFrom ? heldFrom : status;
  const stageIndex = CUSTOMER_STAGE_OF[effective] ?? 0;

  if (onHold) return { stageIndex, label: 'On hold', tone: 'hold', onHold: true, note: BRANCH_NOTES[OrderStatus.ON_HOLD] ?? null, terminatedEarly: false };

  const tone: CustomerTone = stageIndex === 3 ? 'delivered' : stageIndex === 2 ? 'transit' : 'active';
  return { stageIndex, label: customerPillLabel(effective, stageIndex), tone, onHold: false, note: BRANCH_NOTES[status] ?? null, terminatedEarly: false };
}

export interface CustomerTimeline {
  /** Exactly 4 nodes (Placed → Picked up → Out for delivery → Delivered). */
  steps: { label: string; state: StepState }[];
  note: string | null;
  terminatedEarly: boolean;
  onHold: boolean;
}

/** The 4-node customer tracker (done/current/upcoming). Screens render this instead of the 15-node spine. */
export function buildCustomerTimeline(status: OrderStatus, heldFrom?: OrderStatus | null): CustomerTimeline {
  const v = customerStatus(status, heldFrom);
  const anchor = v.stageIndex ?? 0;
  const steps = CUSTOMER_STAGE_LABELS.map((label, i) => ({
    label,
    state: (i < anchor ? 'done' : i === anchor && !v.terminatedEarly ? 'current' : 'upcoming') as StepState,
  }));
  return { steps, note: v.note, terminatedEarly: v.terminatedEarly, onHold: v.onHold };
}
