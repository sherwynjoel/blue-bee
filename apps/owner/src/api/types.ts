import type { ItemKind, ItemStatus, OrderStatus, QuoteStatus } from '@blue-bee/shared';

/**
 * Owner-app view models for the drill-through reads (GET /v1/orders/:id, GET /v1/routes/:id). The
 * server returns the Prisma graph; these are the exact fields the owner app renders — a typed lens
 * (enums from @blue-bee/shared, the single source of truth). Money/measures arrive as decimal strings.
 * The owner app is READ-ONLY here except the quote approve/decline action (PRD §7C C5 drill-through).
 */

export interface OrderTotals {
  currency?: string;
  estimateRange?: { low: string; high: string; currency: string; basis?: string };
  subtotal?: string;
  tax?: string;
  total?: string;
  taxRate?: string;
  paymentStatus?: 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
}

export interface QuoteView {
  id: string;
  status: QuoteStatus;
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  expiresAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/** An append-only chain-of-custody scan (PRD §8.2) — the timeline the owner drills into (§7C C5). */
export interface CustodyEventView {
  id: string;
  stage: string;
  occurredAt: string;
}

export interface ItemView {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  custodyEvents: CustodyEventView[];
}

export interface RouteStopRef {
  id: string;
  kind: string;
  seq: number;
  status: string;
  eta: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  routeId: string;
}

/** GET /v1/orders/:id — the order detail the owner reads (drill-through target). */
export interface OrderDetail {
  id: string;
  orgId: string;
  accountId: string;
  status: OrderStatus;
  heldFrom: OrderStatus | null;
  totals: OrderTotals | null;
  createdAt: string;
  updatedAt: string;
  items: ItemView[];
  quotes: QuoteView[];
  routeStops: RouteStopRef[];
}

/** A stop as returned inside GET /v1/routes/:id (ordered by seq). */
export interface RouteStopView {
  id: string;
  seq: number;
  kind: string;
  status: string;
  orderId: string | null;
  exceptionReason: string | null;
  eta: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  site?: { name: string } | null;
}

/** GET /v1/routes/:id — a route with its ordered stops + driver/vehicle (truck → stops drill). */
export interface RouteDetail {
  id: string;
  status: string;
  date: string | null;
  optimized: boolean;
  driverId: string | null;
  vehicleId: string | null;
  stops: RouteStopView[];
}

/** A row of GET /v1/routes (used to resolve a vehicle's active route from the fleet map). */
export interface RouteSummary {
  id: string;
  status: string;
  vehicleId: string | null;
  driverId: string | null;
  date: string | null;
}

export interface RouteListResult {
  routes: RouteSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}
