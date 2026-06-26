import React from 'react';
import { OrderStatus } from '@blue-bee/shared';
import { statusLabel } from '../../src/orders/timeline';
import { Badge, type BadgeTone } from './Badge';

/**
 * Maps an order status to a Daylight tone — the customer's at-a-glance read of "good / in motion /
 * needs me / heads-up / stopped". Label text comes from the canonical `statusLabel` (single source).
 */
export function statusTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case OrderStatus.QUOTED:
      return 'honey'; // needs the customer's decision
    case OrderStatus.QUOTE_APPROVED:
    case OrderStatus.READY:
    case OrderStatus.DELIVERED:
    case OrderStatus.INVOICED:
    case OrderStatus.CLOSED:
    case OrderStatus.CLAIM_RESOLVED:
      return 'success';
    case OrderStatus.ON_HOLD:
    case OrderStatus.REWASH:
    case OrderStatus.DAMAGE_PREEXISTING_FLAGGED:
    case OrderStatus.CLAIM_OPENED:
      return 'warning';
    case OrderStatus.QUOTE_DECLINED:
    case OrderStatus.CLOSED_NO_WORK:
      return 'danger';
    case OrderStatus.REQUESTED:
      return 'neutral';
    default:
      // Everything in motion (pickup/delivery en route, picked up, inspected, cleaning, QC, scheduled…)
      return 'azure';
  }
}

/** True when the order is in a live motion state worth animating the dot for. */
function isMoving(status: OrderStatus): boolean {
  return status === OrderStatus.PICKUP_EN_ROUTE || status === OrderStatus.DELIVERY_EN_ROUTE;
}

export interface StatusPillProps {
  status: OrderStatus;
  testID?: string;
}

/** The status badge used across orders list + detail header. */
export function StatusPill({ status, testID }: StatusPillProps): React.ReactElement {
  return <Badge testID={testID} label={statusLabel(status)} tone={statusTone(status)} dot={isMoving(status)} />;
}
