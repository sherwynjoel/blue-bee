import { ApiClient, type TokenStore } from '@blue-bee/api-client';
import type {
  AddStopDto,
  AssignRouteDto,
  ConfirmMediaDto,
  CreateDriverDto,
  CreateRouteDto,
  CreateShiftDto,
  CreateVehicleDto,
  DeclineQuoteDto,
  DisputeView,
  FleetLiveResult,
  GenerateInvoiceDto,
  InspectionDto,
  InvoiceView,
  ListOrdersQuery,
  ListRoutesQuery,
  MediaResult,
  OptimizeRouteDto,
  PatchStopDto,
  PaymentView,
  PresignMediaDto,
  PresignMediaResult,
  PublishRouteDto,
  QuoteBuildDto,
  ReceivedAtPlantDto,
  RefundPaymentDto,
  RefundView,
  SchedulePickupDto,
  ServiceCatalogResult,
  ShiftActionDto,
  StopActionDto,
  StopExceptionDto,
} from '@blue-bee/shared';
import type {
  DriverView,
  ManifestView,
  OrderDetail,
  OrderListResult,
  RouteListResult,
  RouteView,
  ShiftView,
  VehicleView,
} from './types';

/** The §5.4 stop transitions the OPS console can drive (colon-action routes). */
export type StopAction = 'depart' | 'arrive' | 'start' | 'complete' | 'fail' | 'skip';

/**
 * The console's typed transport over the PROVEN `/v1` API (Increment 13) — extends the shared
 * `ApiClient` (fetch + injectable web TokenStore + single-flight 401→refresh→retry +
 * problem+json→ApiError) with the ops domain surface: orders/intake/quote, logistics/dispatch,
 * fleet, media, and the Inc-12 finance reads/writes. Every contract comes from `@blue-bee/shared`;
 * all business logic (quote math, state machines, sequencing, refund ceilings) stays SERVER-side —
 * the console only calls the endpoint and renders the result.
 */
export class ConsoleApiClient extends ApiClient {
  /** The current access token — needed for the `WS /live/fleet` handshake auth (Inc 6 contract). */
  async accessToken(): Promise<string | null> {
    return this.store.getAccess();
  }

  // ───────────── orders / intake / quote ─────────────

  listOrders(query: ListOrdersQuery = { limit: 25 }): Promise<OrderListResult> {
    const p = new URLSearchParams();
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.cursor) p.set('cursor', query.cursor);
    if (query.status) p.set('status', query.status);
    const qs = p.toString();
    return this.request('GET', `/orders${qs ? `?${qs}` : ''}`);
  }

  getOrder(id: string): Promise<OrderDetail> {
    return this.request('GET', `/orders/${id}`);
  }

  schedulePickup(id: string, dto: SchedulePickupDto): Promise<OrderDetail> {
    return this.request('POST', `/orders/${id}/schedule-pickup`, { body: dto });
  }

  receivedAtPlant(id: string, dto: ReceivedAtPlantDto = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${id}/received-at-plant`, { body: dto });
  }

  inspectItem(id: string, itemId: string, dto: InspectionDto): Promise<OrderDetail> {
    return this.request('POST', `/orders/${id}/items/${itemId}/inspection`, { body: dto });
  }

  buildQuote(id: string, dto: QuoteBuildDto): Promise<{ order: OrderDetail; quoteId: string }> {
    return this.request('POST', `/orders/${id}/quote`, { body: dto });
  }

  approveQuote(id: string, dto: { note?: string } = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${id}/quote:approve`, { body: dto });
  }

  declineQuote(id: string, dto: DeclineQuoteDto = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${id}/quote:decline`, { body: dto });
  }

  holdOrder(id: string, dto: { reason: string }): Promise<OrderDetail> {
    return this.request('POST', `/orders/${id}/hold`, { body: dto });
  }

  resumeOrder(id: string, dto: { note?: string } = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${id}/resume`, { body: dto });
  }

  // ───────────── catalog (booking context) ─────────────

  getServices(): Promise<ServiceCatalogResult> {
    return this.request('GET', '/services');
  }

  // ───────────── logistics / dispatch ─────────────

  listVehicles(): Promise<VehicleView[]> {
    return this.request('GET', '/vehicles');
  }
  createVehicle(dto: CreateVehicleDto): Promise<VehicleView> {
    return this.request('POST', '/vehicles', { body: dto });
  }
  listDrivers(): Promise<DriverView[]> {
    return this.request('GET', '/drivers');
  }
  createDriver(dto: CreateDriverDto): Promise<DriverView> {
    return this.request('POST', '/drivers', { body: dto });
  }
  listShifts(): Promise<ShiftView[]> {
    return this.request('GET', '/shifts');
  }
  createShift(dto: CreateShiftDto): Promise<ShiftView> {
    return this.request('POST', '/shifts', { body: dto });
  }
  startShift(id: string, dto: ShiftActionDto = {}): Promise<ShiftView> {
    return this.request('POST', `/shifts/${id}:start`, { body: dto });
  }
  endShift(id: string, dto: ShiftActionDto = {}): Promise<ShiftView> {
    return this.request('POST', `/shifts/${id}:end`, { body: dto });
  }

  listRoutes(query: ListRoutesQuery = { limit: 25 }): Promise<RouteListResult> {
    const p = new URLSearchParams();
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.cursor) p.set('cursor', query.cursor);
    if (query.status) p.set('status', query.status);
    const qs = p.toString();
    return this.request('GET', `/routes${qs ? `?${qs}` : ''}`);
  }
  getRoute(id: string): Promise<RouteView> {
    return this.request('GET', `/routes/${id}`);
  }
  createRoute(dto: CreateRouteDto): Promise<RouteView> {
    return this.request('POST', '/routes', { body: dto });
  }
  /** Returns the CREATED stop (not the route) — the caller re-fetches the route to re-sync. */
  addStop(id: string, dto: AddStopDto): Promise<import('./types').RouteStopOpsView> {
    return this.request('POST', `/routes/${id}/stops`, { body: dto });
  }
  assignRoute(id: string, dto: AssignRouteDto): Promise<RouteView> {
    return this.request('POST', `/routes/${id}/assign`, { body: dto });
  }
  optimizeRoute(id: string, dto: OptimizeRouteDto = {}): Promise<RouteView> {
    return this.request('POST', `/routes/${id}/optimize`, { body: dto });
  }
  publishRoute(id: string, dto: PublishRouteDto = {}): Promise<RouteView> {
    return this.request('POST', `/routes/${id}/publish`, { body: dto });
  }
  routeManifest(id: string): Promise<ManifestView> {
    return this.request('POST', `/routes/${id}/manifest`, { body: {} });
  }
  patchStop(id: string, dto: PatchStopDto): Promise<RouteView> {
    return this.request('PATCH', `/route-stops/${id}`, { body: dto });
  }

  /** A §5.4 stop transition (colon-action route). fail/skip require a reason. */
  stopAction(id: string, action: StopAction, dto: StopActionDto | StopExceptionDto = {}): Promise<RouteStopActionResult> {
    return this.request('POST', `/route-stops/${id}:${action}`, { body: dto });
  }

  // ───────────── fleet (Inc 5–7) ─────────────

  fleetLive(): Promise<FleetLiveResult> {
    return this.request('GET', '/fleet/live');
  }

  // ───────────── media (Inc 10) ─────────────

  presignMedia(dto: PresignMediaDto): Promise<PresignMediaResult> {
    return this.request('POST', '/media/presign', { body: dto });
  }
  confirmMedia(dto: ConfirmMediaDto): Promise<MediaResult> {
    return this.request('POST', '/media/confirm', { body: dto });
  }

  // ───────────── finance (Inc 12) ─────────────

  getPayment(orderId: string): Promise<PaymentView | null> {
    return this.request('GET', `/orders/${orderId}/payment`);
  }
  getInvoice(orderId: string): Promise<InvoiceView | null> {
    return this.request('GET', `/orders/${orderId}/invoice`);
  }
  generateInvoice(orderId: string, dto: GenerateInvoiceDto = {}): Promise<InvoiceView> {
    return this.request('POST', `/orders/${orderId}/invoice`, { body: dto });
  }
  refundPayment(paymentId: string, dto: RefundPaymentDto = {}): Promise<RefundView> {
    return this.request('POST', `/payments/${paymentId}/refund`, { body: dto });
  }
  listDisputes(): Promise<DisputeView[]> {
    return this.request('GET', '/disputes');
  }
}

/** A §5.4 stop transition returns the updated stop (status + exception/timestamps). */
export type RouteStopActionResult = import('./types').RouteStopOpsView;

/** Singleton console client (created once with the web token store — the single-flight refresh lives on it). */
let singleton: ConsoleApiClient | null = null;
export function getConsoleClient(baseUrl: string, store: TokenStore): ConsoleApiClient {
  if (!singleton) singleton = new ConsoleApiClient(baseUrl, store);
  return singleton;
}
