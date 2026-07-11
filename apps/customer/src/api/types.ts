import type { ItemKind, ItemStatus, OrderStatus, PhotoKind, QuoteStatus, RatingView } from '@blue-bee/shared';

/**
 * Customer-facing view models for the order reads (GET /v1/orders + GET /v1/orders/:id). The server
 * returns the Prisma order graph (FULL_INCLUDE); these are the exact fields the customer app reads —
 * a typed lens over that response (the enums come from @blue-bee/shared, the single source of truth).
 * Numeric money/measures arrive as decimal STRINGS over the wire.
 */

export interface EstimateRange {
  low: string;
  high: string;
  currency: string;
  basis?: string;
}

/** order.totals — a pre-intake estimate range, or the post-quote totals (both optional). */
export interface OrderTotals {
  currency?: string;
  notes?: string;
  estimateRange?: EstimateRange;
  subtotal?: string;
  tax?: string;
  total?: string;
  taxRate?: string;
  /** The order's billing state, mirrored by the webhook (Increment 12). */
  paymentStatus?: 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
}

export interface TimeWindowJson {
  start: string;
  end: string;
}

export interface QuoteView {
  id: string;
  status: QuoteStatus;
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adjustments: any;
  expiresAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface InspectionView {
  id: string;
  preexistingDamage: boolean;
  conditionCodes: string[];
  notes: string | null;
  ackBy: string | null;
  ackAt: string | null;
  createdAt: string;
}

/** A signed item photo — `downloadUrl` is a short-lived signed GET; the raw key is never present. */
export interface PhotoView {
  id: string;
  kind: PhotoKind;
  contentType: string | null;
  sizeBytes: number | null;
  takenAt: string;
  createdAt: string;
  downloadUrl: string | null;
}

export interface CustodyEventView {
  id: string;
  stage: string;
  occurredAt: string;
}

export interface ItemView {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  measurements: any;
  inspections: InspectionView[];
  photos: PhotoView[];
  custodyEvents: CustodyEventView[];
}

export interface RouteStopView {
  id: string;
  kind: string;
  seq: number;
  status: string;
  eta: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  routeId: string;
}

/** GET /v1/orders/:id — the full order detail the customer reads. */
export interface OrderDetail {
  id: string;
  orgId: string;
  accountId: string;
  /**
   * [Inc-16] The effective PRICING account (Inc-15) — set when this order is priced on a corporate
   * account's rate card (a building match or a redeemed membership); null ⇒ priced on the payer's own
   * account. `pricingAccount.name` is the corporate account name shown as the "corporate pricing"
   * indicator. Server truth — the app never computes pricing.
   */
  pricingAccountId: string | null;
  pricingAccount: { name: string } | null;
  siteId: string | null;
  vertical: string;
  type: string;
  status: OrderStatus;
  heldFrom: OrderStatus | null;
  scheduledPickupWindow: TimeWindowJson | null;
  scheduledDeliveryWindow: TimeWindowJson | null;
  totals: OrderTotals | null;
  createdAt: string;
  updatedAt: string;
  items: ItemView[];
  quotes: QuoteView[];
  routeStops: RouteStopView[];
  /** [Inc-32] The order's post-delivery rating, or null when unrated. Embedded by the server's FULL_INCLUDE
   *  so the "Rate this order" CTA (delivered-and-unrated) or the submitted score renders in one round-trip. */
  rating: RatingView | null;
}

/** GET /v1/orders — list rows (each carries the latest quote). */
export interface OrderSummary {
  id: string;
  status: OrderStatus;
  vertical: string;
  accountId: string;
  siteId: string | null;
  totals: OrderTotals | null;
  createdAt: string;
  quotes: QuoteView[];
  /** [Inc-32] The order's rating (or null) — so a delivered card shows its score or the Rate CTA. */
  rating: RatingView | null;
}

export interface OrderListResult {
  orders: OrderSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}
