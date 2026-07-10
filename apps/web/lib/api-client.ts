import { ApiClient, ApiError, type TokenStore } from '@blue-bee/api-client';
import type {
  AccountScorecard,
  AddStopDto,
  AdminDevice,
  AdminDevicesResult,
  AdminDriversResult,
  AdminUserRolesResult,
  AdminUsersResult,
  AssignDriverVehicleDto,
  AssignRoleDto,
  AssignRouteDto,
  AuditLogResult,
  CommercialAnalytics,
  ConfirmMediaDto,
  CreateDeviceDto,
  CreateDriverDto,
  NotificationConfigView,
  CreateRouteDto,
  CreateShiftDto,
  CreateVehicleDto,
  DeclineQuoteDto,
  DisputeView,
  FleetLiveResult,
  GenerateInvoiceDto,
  InspectionDto,
  InvoiceListResult,
  InvoiceView,
  ListInvoicesQuery,
  ListOrdersQuery,
  PayInvoiceDto,
  PaymentIntentResponse,
  ListRoutesQuery,
  MediaResult,
  OperationalAnalytics,
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
  // Facility-linen par loop (Track B Phase 2).
  AdjustLinenStockDto,
  GeneratePackToParDto,
  LinenStockAdjustResult,
  LinenStockListResult,
  PackToParManifestListResult,
  PackToParManifestView,
  PackToParView,
  ParLevelListResult,
  ParLevelView,
  RecordSoilPickupDto,
  SetParLevelDto,
  SoilPickupListResult,
  SoilPickupView,
  UpdateParLevelDto,
} from '@blue-bee/shared';
import type {
  AccountDetailView,
  AccountListResult,
  AccountManifestsResult,
  AttachOrderCostCenterDto,
  BatchInvoiceDto,
  BillingTermsView,
  CostCenterListResult,
  CostCenterReportView,
  CostCenterView,
  CreateCostCenterDto,
  OrderCostCenterView,
  UpdateCostCenterDto,
  // Corporate accounts + rate cards + building match (Inc-15).
  CorporateAccountView,
  CorporateAccountsResult,
  CorporateBuildingView,
  CorporateBuildingsResult,
  CreateBuildingDto,
  CreateCorporateAccountDto,
  GenerateJoinCodeDto,
  JoinCodeView,
  MembershipsResult,
  RateCardItemView,
  RateCardView,
  RedeemJoinCodeDto,
  RedeemResultView,
  SetRateCardItemDto,
  UpdateBuildingDto,
  UpdateCorporateAccountDto,
  // Dry-clean visual catalog (Inc-17).
  AdminCatalogView,
  CatalogImagePresignResult,
  CatalogItemView,
  CategoriesResult,
  CategoryView,
  CreateCatalogItemDto,
  CreateCategoryDto,
  PresignCatalogImageDto,
  UpdateCatalogItemDto,
  UpdateCategoryDto,
  // Service menu — the 8 top-level Home cards + rate editor (Inc-21).
  ServiceMenuResult,
  ServiceMenuCardView,
  UpdateServiceMenuCardDto,
  // Reorder (Inc-24).
  ReorderCatalogDto,
  CatalogReorderResult,
  CreateResidentDto,
  CreateStandingOrderDto,
  DropToLostFoundDto,
  EnrollGarmentDto,
  GarmentView,
  GeneratedForAccountView,
  GenerationResult,
  ListAccountsQuery,
  ListStandingOrdersQuery,
  LostFoundPoolResult,
  OwnerExceptionsResult,
  ReconcileDto,
  ReconciliationReport,
  ResidentClothingView,
  ResidentListResult,
  ResidentView,
  RunGenerationDto,
  SetBillingTermsDto,
  StandingOrderOccurrenceView,
  StandingOrderView,
  TransitionGarmentDto,
  UpdateStandingOrderDto,
  // Geo-blocking: service zones + coverage requests (Inc-19).
  CoverageRequestsResult,
  CreateServiceZoneDto,
  ListCoverageRequestsQuery,
  ServiceZoneView,
  ServiceZonesResult,
  UpdateServiceZoneDto,
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
// [Inc-23 P3] weight capture (order-scoped read + audited override).
import type { CaptureWeightDto, OrderWeightView, WeightCaptureResult } from '@blue-bee/shared';

/** Standing-order list page (cursor-paginated) — the server's list shape. */
export interface StandingOrderListResult {
  standingOrders: StandingOrderView[];
  nextCursor: string | null;
  hasMore: boolean;
}

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

  // ───────────── weight (Inc-22/23 P3) — authoritative weight + audited owner override ─────────────

  /** The order's authoritative weight + weigh point + full append-only capture history + customer estimate. */
  orderWeight(orderId: string): Promise<OrderWeightView> {
    return this.request('GET', `/orders/${orderId}/weight`);
  }

  /**
   * Post an AUDITED weight correction (owner/plant) — writes a NEW append-only capture (never mutates
   * history); the authoritative weight becomes this one. Server-side RBAC + org-scoping enforced.
   */
  weighOrder(orderId: string, dto: CaptureWeightDto): Promise<WeightCaptureResult> {
    return this.request('POST', `/orders/${orderId}/weigh`, { body: dto });
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

  // ───────────── service zones + coverage (Inc 19 — geo-blocking) ─────────────

  listZones(): Promise<ServiceZonesResult> {
    return this.request('GET', '/service-zones');
  }
  createZone(dto: CreateServiceZoneDto): Promise<ServiceZoneView> {
    return this.request('POST', '/service-zones', { body: dto });
  }
  updateZone(id: string, dto: UpdateServiceZoneDto): Promise<ServiceZoneView> {
    return this.request('PATCH', `/service-zones/${id}`, { body: dto });
  }
  listCoverageRequests(query: ListCoverageRequestsQuery = { limit: 50 }): Promise<CoverageRequestsResult> {
    const p = new URLSearchParams();
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.cursor) p.set('cursor', query.cursor);
    const qs = p.toString();
    return this.request('GET', `/coverage-requests${qs ? `?${qs}` : ''}`);
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

  // ───────────── analytics (Inc 15, PRD §13) ─────────────

  analyticsOperational(range: AnalyticsRange = {}): Promise<OperationalAnalytics> {
    return this.request('GET', `/analytics/operational${rangeQs(range)}`);
  }
  analyticsCommercial(range: AnalyticsRange = {}): Promise<CommercialAnalytics> {
    return this.request('GET', `/analytics/commercial${rangeQs(range)}`);
  }
  accountScorecard(accountId: string, range: AnalyticsRange = {}): Promise<AccountScorecard> {
    return this.request('GET', `/analytics/accounts/${accountId}/scorecard${rangeQs(range)}`);
  }

  // ───────────── admin (Inc 16, PRD Epic B6.2 — OWNER-gated) ─────────────

  adminListUsers(): Promise<AdminUsersResult> {
    return this.request('GET', '/admin/users');
  }
  adminAssignRole(userId: string, dto: AssignRoleDto): Promise<AdminUserRolesResult> {
    return this.request('POST', `/admin/users/${userId}/roles`, { body: dto });
  }
  adminRevokeRole(userId: string, roleId: string): Promise<AdminUserRolesResult> {
    return this.request('DELETE', `/admin/users/${userId}/roles/${roleId}`);
  }
  adminListDevices(): Promise<AdminDevicesResult> {
    return this.request('GET', '/admin/devices');
  }
  adminCreateDevice(dto: CreateDeviceDto): Promise<AdminDevice> {
    return this.request('POST', '/admin/devices', { body: dto });
  }
  adminDeleteDevice(id: string): Promise<void> {
    return this.request('DELETE', `/admin/devices/${id}`);
  }
  adminListDrivers(): Promise<AdminDriversResult> {
    return this.request('GET', '/admin/drivers');
  }
  adminAssignDriverVehicle(driverId: string, dto: AssignDriverVehicleDto): Promise<AdminDriversResult['drivers'][number]> {
    return this.request('PATCH', `/admin/drivers/${driverId}`, { body: dto });
  }
  adminNotificationConfig(): Promise<NotificationConfigView> {
    return this.request('GET', '/admin/notification-config');
  }
  adminAuditLogs(query: AdminAuditQuery = {}): Promise<AuditLogResult> {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, String(v));
    const qs = p.toString();
    return this.request('GET', `/admin/audit-logs${qs ? `?${qs}` : ''}`);
  }

  // ───────────── Track-A: B2B accounts (condo console) ─────────────

  /** Account directory (org-scoped, cursor-paginated). */
  listAccounts(query: ListAccountsQuery = { limit: 25 }): Promise<AccountListResult> {
    const p = new URLSearchParams();
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.cursor) p.set('cursor', query.cursor);
    const qs = p.toString();
    return this.request('GET', `/accounts${qs ? `?${qs}` : ''}`);
  }
  getAccount(id: string): Promise<AccountDetailView> {
    return this.request('GET', `/accounts/${id}`);
  }

  // standing / recurring orders (CRUD + the org-wide generation run)
  listStandingOrders(query: ListStandingOrdersQuery = { limit: 50 }): Promise<StandingOrderListResult> {
    const p = new URLSearchParams();
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.cursor) p.set('cursor', query.cursor);
    if (query.accountId) p.set('accountId', query.accountId);
    if (query.active != null) p.set('active', String(query.active));
    const qs = p.toString();
    return this.request('GET', `/standing-orders${qs ? `?${qs}` : ''}`);
  }
  getStandingOrderOccurrences(id: string): Promise<{ standingOrderId: string; occurrences: StandingOrderOccurrenceView[] }> {
    return this.request('GET', `/standing-orders/${id}/occurrences`);
  }
  createStandingOrder(dto: CreateStandingOrderDto): Promise<StandingOrderView> {
    return this.request('POST', '/standing-orders', { body: dto });
  }
  updateStandingOrder(id: string, dto: UpdateStandingOrderDto): Promise<StandingOrderView> {
    return this.request('PATCH', `/standing-orders/${id}`, { body: dto });
  }
  deleteStandingOrder(id: string): Promise<void> {
    return this.request('DELETE', `/standing-orders/${id}`);
  }
  /** Run ONE org-wide generation pass (materializes ALL the org's due standing orders — not per-account). */
  runStandingOrderGeneration(dto: RunGenerationDto = {}): Promise<GenerationResult> {
    return this.request('POST', '/standing-orders/run', { body: dto });
  }

  // per-account billing terms + the batch/periodic invoice + the generated feed
  getBillingTerms(accountId: string): Promise<BillingTermsView> {
    return this.request('GET', `/accounts/${accountId}/billing-terms`);
  }
  setBillingTerms(accountId: string, dto: SetBillingTermsDto): Promise<BillingTermsView> {
    return this.request('PUT', `/accounts/${accountId}/billing-terms`, { body: dto });
  }
  batchInvoice(accountId: string, dto: BatchInvoiceDto): Promise<InvoiceView> {
    return this.request('POST', `/accounts/${accountId}/invoices/batch`, { body: dto });
  }
  getGeneratedForAccount(accountId: string): Promise<GeneratedForAccountView> {
    return this.request('GET', `/accounts/${accountId}/generated`);
  }

  // account portal tabs — Orders / Manifests / Exceptions (read-only, account-scoped)

  /** The account's orders (cursor-paginated; the server delegates to the proven order listing). */
  getAccountOrders(accountId: string, query: ListOrdersQuery = { limit: 25 }): Promise<OrderListResult> {
    const p = new URLSearchParams();
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.cursor) p.set('cursor', query.cursor);
    if (query.status) p.set('status', query.status);
    const qs = p.toString();
    return this.request('GET', `/accounts/${accountId}/orders${qs ? `?${qs}` : ''}`);
  }
  /** The account's recent route-stop manifests (a read-only view — does not generate). */
  getAccountManifests(accountId: string): Promise<AccountManifestsResult> {
    return this.request('GET', `/accounts/${accountId}/manifests`);
  }
  /** The account's exceptions feed (failed/skipped stops, held orders, open disputes, failed payments). */
  getAccountExceptions(accountId: string): Promise<OwnerExceptionsResult> {
    return this.request('GET', `/accounts/${accountId}/exceptions`);
  }

  // ───────────── Track-A: cost centres (split billing — PRD §B4.1/§A5.2/§B5.2) ─────────────

  /** An account's cost centres (org-scoped; OWNER/FINANCE/DISPATCHER/CSR). `active` filters in/active. */
  listCostCenters(accountId: string, query: { active?: boolean } = {}): Promise<CostCenterListResult> {
    const qs = query.active != null ? `?active=${String(query.active)}` : '';
    return this.request('GET', `/accounts/${accountId}/cost-centers${qs}`);
  }
  /** Create a cost centre under an account (FINANCE; code unique per account → 409). */
  createCostCenter(accountId: string, dto: CreateCostCenterDto): Promise<CostCenterView> {
    return this.request('POST', `/accounts/${accountId}/cost-centers`, { body: dto });
  }
  /** Rename / re-classify / activate-deactivate a cost centre by id (FINANCE; `code` is immutable). */
  updateCostCenter(id: string, dto: UpdateCostCenterDto): Promise<CostCenterView> {
    return this.request('PATCH', `/cost-centers/${id}`, { body: dto });
  }
  /** Attach (or detach with `costCenterId: null`) a cost centre to an order (OWNER/FINANCE/DISPATCHER/CSR). */
  attachOrderCostCenter(orderId: string, dto: AttachOrderCostCenterDto): Promise<OrderCostCenterView> {
    return this.request('PUT', `/orders/${orderId}/cost-center`, { body: dto });
  }
  /** Per-cost-centre period totals over [from, to) (ISO-8601; from < to). Includes an Unassigned bucket. */
  getCostCenterReport(accountId: string, q: { from: string; to: string }): Promise<CostCenterReportView> {
    const p = new URLSearchParams({ from: q.from, to: q.to });
    return this.request('GET', `/accounts/${accountId}/cost-centers/report?${p.toString()}`);
  }
  /**
   * The §B5.2 cost-centre CSV export — fetches the real `text/csv` attachment bytes for [from, to).
   * Returns the blob + the server's filename; the browser download (objectURL + anchor) stays in the
   * component so this transport is SSR-safe. Same `/v1` base + bearer as `request`; non-2xx → ApiError.
   */
  async downloadCostCenterReportCsv(accountId: string, q: { from: string; to: string }): Promise<{ blob: Blob; filename: string }> {
    const token = await this.accessToken();
    const p = new URLSearchParams({ from: q.from, to: q.to });
    const res = await fetch(`${this.base}/accounts/${accountId}/cost-centers/report.csv?${p.toString()}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await ApiError.from(res);
    const blob = await res.blob();
    return { blob, filename: attachmentFilename(res.headers.get('content-disposition')) ?? `cost-centres-${accountId}.csv` };
  }

  // ───────────── Track-B: resident personal clothing (care homes) ─────────────

  /** A site's residents (audited server-side). */
  listResidents(siteId: string): Promise<ResidentListResult> {
    return this.request('GET', `/residents?siteId=${encodeURIComponent(siteId)}`);
  }
  getResident(residentId: string): Promise<ResidentView> {
    return this.request('GET', `/residents/${residentId}`);
  }
  /** The A4.2 view — a resident's garments in the four buckets (audited). */
  getResidentClothing(residentId: string): Promise<ResidentClothingView> {
    return this.request('GET', `/residents/${residentId}/clothing`);
  }
  createResident(dto: CreateResidentDto): Promise<ResidentView> {
    return this.request('POST', '/residents', { body: dto });
  }
  /** Enroll a garment to a resident (tag↔resident → GARMENT_ENROLLED). */
  enrollGarment(residentId: string, dto: EnrollGarmentDto): Promise<GarmentView> {
    return this.request('POST', `/residents/${residentId}/garments`, { body: dto });
  }
  /** Advance a garment one step along the §5.2-B lifecycle (409 on an illegal transition). */
  transitionGarment(garmentId: string, dto: TransitionGarmentDto): Promise<GarmentView> {
    return this.request('POST', `/garments/${garmentId}/transition`, { body: dto });
  }
  dropGarmentToLostFound(garmentId: string, dto: DropToLostFoundDto = {}): Promise<import('@blue-bee/shared').LostFoundItemView> {
    return this.request('POST', `/garments/${garmentId}/lost-found`, { body: dto });
  }
  /** A site's OPEN lost & found pool (audited). */
  getLostFoundPool(siteId: string): Promise<LostFoundPoolResult> {
    return this.request('GET', `/lost-found?siteId=${encodeURIComponent(siteId)}`);
  }
  getReconciliationReport(siteId: string): Promise<ReconciliationReport> {
    return this.request('GET', `/lost-found/report?siteId=${encodeURIComponent(siteId)}`);
  }
  /** Reconcile a pooled garment back to a resident (LOST_FOUND_POOL → RECONCILE). */
  reconcileLostFound(lostFoundId: string, dto: ReconcileDto): Promise<GarmentView> {
    return this.request('POST', `/lost-found/${lostFoundId}/reconcile`, { body: dto });
  }

  // ───────────── Track-A: B2B self-serve invoice portal (account-admin) ─────────────

  /** The caller's own account's invoices (cursor-paginated; server confines ACCOUNT_* tokens by scope). */
  listInvoices(query: ListInvoicesQuery = { limit: 25 }): Promise<InvoiceListResult> {
    const p = new URLSearchParams();
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.cursor) p.set('cursor', query.cursor);
    if (query.status) p.set('status', query.status);
    const qs = p.toString();
    return this.request('GET', `/invoices${qs ? `?${qs}` : ''}`);
  }
  /** Invoice detail — header + lines + the cost-centre split (out-of-scope id → 404). */
  getInvoiceById(id: string): Promise<InvoiceView> {
    return this.request('GET', `/invoices/${id}`);
  }
  /**
   * Create/re-attempt the invoice PaymentIntent (B2B portal). Amount = the invoice total incl. HST,
   * computed server-side; returns the client secret only. An idempotency-key makes a timeout/retry
   * reuse the pending intent (never a double-charge).
   */
  payInvoice(id: string, dto: PayInvoiceDto = {}, idempotencyKey?: string): Promise<PaymentIntentResponse> {
    return this.request('POST', `/invoices/${id}/payment-intent`, { body: dto, idempotencyKey });
  }
  /**
   * The invoice statement as real PDF bytes (account-scoped attachment). Returns the blob + filename;
   * the browser download (objectURL + anchor) stays in the component so this transport is SSR-safe.
   */
  async downloadInvoiceStatement(id: string): Promise<{ blob: Blob; filename: string }> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base}/invoices/${id}/statement.pdf`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await ApiError.from(res);
    const blob = await res.blob();
    return { blob, filename: attachmentFilename(res.headers.get('content-disposition')) ?? `invoice-${id}.pdf` };
  }

  // ───────────── facility linen (care-home par loop, Track B Phase 2) ─────────────

  listParLevels(siteId: string, q: { costCenterId?: string } = {}): Promise<ParLevelListResult> {
    return this.request('GET', `/sites/${encodeURIComponent(siteId)}/par-levels${q.costCenterId ? `?costCenterId=${q.costCenterId}` : ''}`);
  }
  setParLevel(siteId: string, dto: SetParLevelDto): Promise<ParLevelView> {
    return this.request('POST', `/sites/${encodeURIComponent(siteId)}/par-levels`, { body: dto });
  }
  updateParLevel(id: string, dto: UpdateParLevelDto): Promise<ParLevelView> {
    return this.request('PATCH', `/par-levels/${encodeURIComponent(id)}`, { body: dto });
  }
  listLinenStock(siteId: string, q: { costCenterId?: string } = {}): Promise<LinenStockListResult> {
    return this.request('GET', `/sites/${encodeURIComponent(siteId)}/linen-stock${q.costCenterId ? `?costCenterId=${q.costCenterId}` : ''}`);
  }
  adjustLinenStock(siteId: string, dto: AdjustLinenStockDto): Promise<LinenStockAdjustResult> {
    return this.request('POST', `/sites/${encodeURIComponent(siteId)}/linen-stock/adjust`, { body: dto });
  }
  recordSoilPickup(siteId: string, dto: RecordSoilPickupDto): Promise<SoilPickupView> {
    return this.request('POST', `/sites/${encodeURIComponent(siteId)}/soil-pickups`, { body: dto });
  }
  listSoilPickups(siteId: string, q: { costCenterId?: string; limit?: number } = {}): Promise<SoilPickupListResult> {
    const p = new URLSearchParams();
    if (q.costCenterId) p.set('costCenterId', q.costCenterId);
    if (q.limit) p.set('limit', String(q.limit));
    const qs = p.toString();
    return this.request('GET', `/sites/${encodeURIComponent(siteId)}/soil-pickups${qs ? `?${qs}` : ''}`);
  }
  packToPar(siteId: string, q: { costCenterId?: string } = {}): Promise<PackToParView> {
    return this.request('GET', `/sites/${encodeURIComponent(siteId)}/pack-to-par${q.costCenterId ? `?costCenterId=${q.costCenterId}` : ''}`);
  }
  generatePackToPar(siteId: string, dto: GeneratePackToParDto = {}): Promise<PackToParManifestView> {
    return this.request('POST', `/sites/${encodeURIComponent(siteId)}/pack-to-par`, { body: dto });
  }
  listPackToParManifests(siteId: string, q: { limit?: number } = {}): Promise<PackToParManifestListResult> {
    return this.request('GET', `/sites/${encodeURIComponent(siteId)}/pack-to-par/manifests${q.limit ? `?limit=${q.limit}` : ''}`);
  }

  // ─────────────── corporate accounts + rate cards + building match (Inc-15, OWNER/FINANCE) ───────────────

  listCorporateAccounts(): Promise<CorporateAccountsResult> {
    return this.request('GET', '/corporate/accounts');
  }
  getCorporateAccount(accountId: string): Promise<CorporateAccountView> {
    return this.request('GET', `/corporate/accounts/${accountId}`);
  }
  createCorporateAccount(dto: CreateCorporateAccountDto): Promise<CorporateAccountView> {
    return this.request('POST', '/corporate/accounts', { body: dto });
  }
  updateCorporateAccount(accountId: string, dto: UpdateCorporateAccountDto): Promise<CorporateAccountView> {
    return this.request('PATCH', `/corporate/accounts/${accountId}`, { body: dto });
  }
  listCorporateBuildings(accountId: string): Promise<CorporateBuildingsResult> {
    return this.request('GET', `/corporate/accounts/${accountId}/buildings`);
  }
  createCorporateBuilding(accountId: string, dto: CreateBuildingDto): Promise<CorporateBuildingView> {
    return this.request('POST', `/corporate/accounts/${accountId}/buildings`, { body: dto });
  }
  updateCorporateBuilding(siteId: string, dto: UpdateBuildingDto): Promise<CorporateBuildingView> {
    return this.request('PATCH', `/corporate/buildings/${siteId}`, { body: dto });
  }
  getRateCard(accountId: string): Promise<RateCardView> {
    return this.request('GET', `/corporate/accounts/${accountId}/rate-card`);
  }
  setRateCardItem(accountId: string, serviceId: string, dto: SetRateCardItemDto): Promise<RateCardItemView> {
    return this.request('PUT', `/corporate/accounts/${accountId}/rate-card/items/${serviceId}`, { body: dto });
  }
  generateJoinCode(accountId: string, dto: GenerateJoinCodeDto = {}): Promise<JoinCodeView> {
    return this.request('POST', `/corporate/accounts/${accountId}/join-code`, { body: dto });
  }
  /** Member surface (any authenticated user): redeem a join code + read own memberships. */
  redeemJoinCode(dto: RedeemJoinCodeDto): Promise<RedeemResultView> {
    return this.request('POST', '/corporate/redeem', { body: dto });
  }
  listMyMemberships(): Promise<MembershipsResult> {
    return this.request('GET', '/corporate/memberships');
  }

  // ─────────────── dry-clean visual catalog admin (Inc-17, OWNER/FINANCE) ───────────────

  adminCatalog(): Promise<AdminCatalogView> {
    return this.request('GET', '/catalog/admin');
  }
  listCatalogCategories(): Promise<CategoriesResult> {
    return this.request('GET', '/catalog/categories');
  }
  createCatalogCategory(dto: CreateCategoryDto): Promise<CategoryView> {
    return this.request('POST', '/catalog/categories', { body: dto });
  }
  updateCatalogCategory(id: string, dto: UpdateCategoryDto): Promise<CategoryView> {
    return this.request('PATCH', `/catalog/categories/${id}`, { body: dto });
  }
  createCatalogItem(dto: CreateCatalogItemDto): Promise<CatalogItemView> {
    return this.request('POST', '/catalog/items', { body: dto });
  }
  updateCatalogItem(id: string, dto: UpdateCatalogItemDto): Promise<CatalogItemView> {
    return this.request('PATCH', `/catalog/items/${id}`, { body: dto });
  }
  presignCatalogImage(dto: PresignCatalogImageDto): Promise<CatalogImagePresignResult> {
    return this.request('POST', '/catalog/image/presign', { body: dto });
  }

  // ─────────────── service menu — the 8 top-level Home cards + per-unit rate editor (Inc-21, OWNER/FINANCE) ───────────────

  serviceMenu(): Promise<ServiceMenuResult> {
    return this.request('GET', '/catalog/service-menu');
  }
  updateServiceMenuCard(id: string, dto: UpdateServiceMenuCardDto): Promise<ServiceMenuCardView> {
    return this.request('PATCH', `/catalog/service-menu/${id}`, { body: dto });
  }

  // ─────────────── reorder (Inc-24) — send the ids in the desired order; sortOrder is renumbered 0..n-1 ───────────────

  reorderCatalog(dto: ReorderCatalogDto): Promise<CatalogReorderResult> {
    return this.request('PATCH', '/catalog/reorder', { body: dto });
  }
}

/** Filters for the admin audit-log viewer. */
export interface AdminAuditQuery {
  entity?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/** An analytics window — both bounds optional (the server defaults to the last 30 days). */
export interface AnalyticsRange {
  from?: string;
  to?: string;
}

/** Build the `?from=&to=` query string (omitting empty bounds). */
function rangeQs(range: AnalyticsRange): string {
  const p = new URLSearchParams();
  if (range.from) p.set('from', range.from);
  if (range.to) p.set('to', range.to);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/** Pull the filename out of a `Content-Disposition: attachment; filename="…"` header (RFC 6266, quoted or bare). */
function attachmentFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through to the plain filename */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ? plain[1].trim() : null;
}

/** A §5.4 stop transition returns the updated stop (status + exception/timestamps). */
export type RouteStopActionResult = import('./types').RouteStopOpsView;

/** Singleton console client (created once with the web token store — the single-flight refresh lives on it). */
let singleton: ConsoleApiClient | null = null;
export function getConsoleClient(baseUrl: string, store: TokenStore): ConsoleApiClient {
  if (!singleton) singleton = new ConsoleApiClient(baseUrl, store);
  return singleton;
}
