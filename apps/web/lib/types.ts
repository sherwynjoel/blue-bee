import type { ItemKind, ItemStatus, OrderStatus, PhotoKind, QuoteStatus } from '@blue-bee/shared';

/**
 * View models the console reads from the proven API responses (Prisma graphs serialized over JSON).
 * Money/measures arrive as decimal STRINGS. These mirror the customer app's view types (same server
 * responses) plus the ops/logistics shapes. The server is authoritative — these are read-only lenses.
 */

export interface EstimateRange {
  low: string;
  high: string;
  currency: string;
  basis?: string;
}

export interface OrderTotals {
  currency?: string;
  notes?: string;
  estimateRange?: EstimateRange;
  subtotal?: string;
  tax?: string;
  total?: string;
  taxRate?: string;
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

export interface OrderDetail {
  id: string;
  orgId: string;
  accountId: string;
  siteId: string | null;
  /** Track-A Phase 2 cost-centre attribution (null = Unassigned). Carried by the order read; powers the picker. */
  costCenterId: string | null;
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
}

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  vertical: string;
  accountId: string;
  siteId: string | null;
  /** Track-A Phase 2 cost-centre attribution (null = Unassigned). Carried by the list read; powers the account picker. */
  costCenterId: string | null;
  totals: OrderTotals | null;
  createdAt: string;
  quotes: QuoteView[];
}

export interface OrderListResult {
  orders: OrderSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ─────────────────────────── logistics (Inc 4) ───────────────────────────

export interface VehicleView {
  id: string;
  label: string;
  capacity: number | null;
  plate: string | null;
  status: string;
  createdAt: string;
}

export interface DriverView {
  id: string;
  userId: string;
  license: string | null;
  defaultVehicleId: string | null;
  createdAt: string;
}

export interface ShiftView {
  id: string;
  driverId: string;
  vehicleId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface RouteStopOpsView {
  id: string;
  routeId: string;
  seq: number;
  kind: string;
  status: string;
  orderId: string | null;
  accountId: string | null;
  siteId: string | null;
  exceptionReason: string | null;
  eta: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  timeWindow: any;
  order?: { id: string; status: string } | null;
  route?: { id: string; status: string; driverId: string | null } | null;
}

export interface RouteView {
  id: string;
  orgId: string;
  date: string;
  driverId: string | null;
  vehicleId: string | null;
  status: string;
  optimized: boolean;
  createdAt: string;
  driver?: { user?: { id: string; name: string } } | null;
  vehicle?: { id: string; label: string } | null;
  stops: RouteStopOpsView[];
}

export interface RouteListResult {
  routes: RouteView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ManifestLine {
  stopId: string;
  seq: number;
  kind: string;
  orderId: string | null;
  account?: { id: string; name: string } | null;
  site?: { id: string; name: string; address?: string } | null;
  expectedItems: { itemId: string; kind: string; tagCode: string | null; status?: string }[];
  expectedItemCount: number;
}

export interface ManifestView {
  id: string;
  routeId?: string;
  routeStopId?: string;
  lines: ManifestLine[];
  generatedAt: string;
  createdAt: string;
}
