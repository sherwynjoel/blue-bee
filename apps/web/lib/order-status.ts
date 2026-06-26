import { OrderStatus } from '@blue-bee/shared';

/**
 * The §5.1 specialty lifecycle rendered FROM SERVER STATE (`order.status`) — never invented. Compact
 * console version of the customer app's buildTimeline: the happy-path spine + each status's position,
 * so the order detail shows "where this order is". Pure.
 */
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

const LABELS: Record<string, string> = {
  [OrderStatus.REQUESTED]: 'Requested',
  [OrderStatus.SCHEDULED_PICKUP]: 'Pickup scheduled',
  [OrderStatus.PICKUP_EN_ROUTE]: 'Pickup en route',
  [OrderStatus.PICKED_UP]: 'Picked up',
  [OrderStatus.INTAKE_INSPECTED]: 'Inspected',
  [OrderStatus.QUOTED]: 'Quoted',
  [OrderStatus.QUOTE_APPROVED]: 'Quote approved',
  [OrderStatus.IN_CLEANING]: 'In cleaning',
  [OrderStatus.QC]: 'QC',
  [OrderStatus.READY]: 'Ready',
  [OrderStatus.SCHEDULED_DELIVERY]: 'Delivery scheduled',
  [OrderStatus.DELIVERY_EN_ROUTE]: 'Out for delivery',
  [OrderStatus.DELIVERED]: 'Delivered',
  [OrderStatus.INVOICED]: 'Invoiced',
  [OrderStatus.CLOSED]: 'Closed',
  [OrderStatus.QUOTE_DECLINED]: 'Quote declined',
  [OrderStatus.CLOSED_NO_WORK]: 'Closed (no work)',
  [OrderStatus.DAMAGE_PREEXISTING_FLAGGED]: 'Damage flagged',
  [OrderStatus.ON_HOLD]: 'On hold',
  [OrderStatus.REWASH]: 'Re-cleaning',
  [OrderStatus.CLAIM_OPENED]: 'Claim opened',
  [OrderStatus.CLAIM_RESOLVED]: 'Claim resolved',
};

export type StepState = 'done' | 'current' | 'upcoming';
export interface TimelineStep {
  status: OrderStatus;
  label: string;
  state: StepState;
}

export function statusLabel(status: OrderStatus): string {
  return LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase();
}

export function buildTimeline(status: OrderStatus, heldFrom?: OrderStatus | null): TimelineStep[] {
  const effective = status === OrderStatus.ON_HOLD && heldFrom ? heldFrom : status;
  const anchor = STAGE_INDEX[effective] ?? 0;
  return TIMELINE_SPINE.map((s, i) => ({
    status: s,
    label: statusLabel(s),
    state: i < anchor ? 'done' : i === anchor ? 'current' : 'upcoming',
  }));
}
