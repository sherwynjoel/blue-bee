/**
 * Blue Bee — domain enums (single source of truth).
 *
 * These TypeScript enums are mirrored 1:1 by the Prisma enums in
 * `apps/api/prisma/schema.prisma`. The string VALUE equals the identifier so the
 * serialized form matches what Postgres stores for the Prisma enum.
 *
 * Provenance tags:
 *   [§5 NORMATIVE]  — must match the PRD §5 state machines EXACTLY. Do not edit
 *                     without changing the PRD. These are `OrderStatus` (§5.1)
 *                     and `RouteStopStatus` (§5.4).
 *   [§9 LITERAL]    — values are enumerated verbatim in the PRD §9 data model.
 *   [DERIVED]       — a `status`/`type` field exists in §9 but the members are
 *                     not enumerated there; kept minimal and sensible. Flagged
 *                     for owner review (see build report).
 */

// ─────────────────────────── Identity & accounts ───────────────────────────

/** [DERIVED] User.status (§9.1). */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INVITED = 'INVITED',
  SUSPENDED = 'SUSPENDED',
}

/** [§9 LITERAL] UserRole.role (§3.3, §9.1, §17.3 permissions matrix). */
export enum RoleType {
  OWNER = 'OWNER',
  DISPATCHER = 'DISPATCHER',
  CSR = 'CSR',
  PLANT_OP = 'PLANT_OP',
  DRIVER = 'DRIVER',
  FINANCE = 'FINANCE',
  ACCOUNT_ADMIN = 'ACCOUNT_ADMIN',
  ACCOUNT_STAFF = 'ACCOUNT_STAFF',
  RESIDENTIAL_CUSTOMER = 'RESIDENTIAL_CUSTOMER',
}

/** [§9 LITERAL] UserRole.scope (§9.1: scope org|account|site). */
export enum RoleScope {
  ORG = 'ORG',
  ACCOUNT = 'ACCOUNT',
  SITE = 'SITE',
}

/** [§9 LITERAL] Account.type (§9.1: residential|business). */
export enum AccountType {
  RESIDENTIAL = 'RESIDENTIAL',
  BUSINESS = 'BUSINESS',
}

// ─────────────────────────── Catalog & services ────────────────────────────

/** [§9 LITERAL] Service.vertical (§9.2: specialty|linen|washfold). */
export enum ServiceVertical {
  SPECIALTY = 'SPECIALTY',
  LINEN = 'LINEN',
  WASHFOLD = 'WASHFOLD',
}

/** [§9 LITERAL] Service.unit (§9.2: sqft|piece|lb|item). */
export enum ServiceUnit {
  SQFT = 'SQFT',
  PIECE = 'PIECE',
  LB = 'LB',
  ITEM = 'ITEM',
}

// ──────────────────────────── Orders & custody ─────────────────────────────

/** [§9 LITERAL] Order.vertical (§9.3). Mirrors ServiceVertical. */
export enum OrderVertical {
  SPECIALTY = 'SPECIALTY',
  LINEN = 'LINEN',
  WASHFOLD = 'WASHFOLD',
}

/** [§9 LITERAL] Order.type (§9.3: job|route_stop_order). */
export enum OrderType {
  JOB = 'JOB',
  ROUTE_STOP_ORDER = 'ROUTE_STOP_ORDER',
}

/**
 * [§5 NORMATIVE] Specialty job lifecycle — PRD §5.1.
 * Linear spine + every branch state. MUST match the PRD state machine exactly.
 *
 *   REQUESTED → SCHEDULED_PICKUP → PICKUP_EN_ROUTE → PICKED_UP → INTAKE_INSPECTED
 *     → QUOTED → QUOTE_APPROVED → IN_CLEANING → QC → READY
 *     → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED → INVOICED → CLOSED
 *   Branches: QUOTE_DECLINED → CLOSED_NO_WORK · DAMAGE_PREEXISTING_FLAGGED ·
 *             ON_HOLD · REWASH · CLAIM_OPENED → CLAIM_RESOLVED
 */
export enum OrderStatus {
  REQUESTED = 'REQUESTED',
  SCHEDULED_PICKUP = 'SCHEDULED_PICKUP',
  PICKUP_EN_ROUTE = 'PICKUP_EN_ROUTE',
  PICKED_UP = 'PICKED_UP',
  INTAKE_INSPECTED = 'INTAKE_INSPECTED',
  QUOTED = 'QUOTED',
  QUOTE_APPROVED = 'QUOTE_APPROVED',
  QUOTE_DECLINED = 'QUOTE_DECLINED',
  IN_CLEANING = 'IN_CLEANING',
  QC = 'QC',
  READY = 'READY',
  SCHEDULED_DELIVERY = 'SCHEDULED_DELIVERY',
  DELIVERY_EN_ROUTE = 'DELIVERY_EN_ROUTE',
  DELIVERED = 'DELIVERED',
  INVOICED = 'INVOICED',
  CLOSED = 'CLOSED',
  CLOSED_NO_WORK = 'CLOSED_NO_WORK',
  DAMAGE_PREEXISTING_FLAGGED = 'DAMAGE_PREEXISTING_FLAGGED',
  ON_HOLD = 'ON_HOLD',
  REWASH = 'REWASH',
  CLAIM_OPENED = 'CLAIM_OPENED',
  CLAIM_RESOLVED = 'CLAIM_RESOLVED',
}

/** [§9 LITERAL] Item.kind (§9.3: rug|carpet|blind|upholstery|garment|linen). */
export enum ItemKind {
  RUG = 'RUG',
  CARPET = 'CARPET',
  BLIND = 'BLIND',
  UPHOLSTERY = 'UPHOLSTERY',
  GARMENT = 'GARMENT',
  LINEN = 'LINEN',
}

/** [DERIVED] Item.status (§9.3). Per-item progress through the specialty flow. */
export enum ItemStatus {
  RECEIVED = 'RECEIVED',
  INSPECTED = 'INSPECTED',
  IN_CLEANING = 'IN_CLEANING',
  QC = 'QC',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
}

/** [§9 LITERAL] Tag.type (§9.3: qr|barcode|rfid). */
export enum TagType {
  QR = 'QR',
  BARCODE = 'BARCODE',
  RFID = 'RFID',
}

/** [§9 LITERAL] Tag.bound_to (§9.3: item|cart|container|resident). */
export enum TagBinding {
  ITEM = 'ITEM',
  CART = 'CART',
  CONTAINER = 'CONTAINER',
  RESIDENT = 'RESIDENT',
}

/** [§9 LITERAL] Photo.kind (§9.3: intake|before|after|pod|claim). */
export enum PhotoKind {
  INTAKE = 'INTAKE',
  BEFORE = 'BEFORE',
  AFTER = 'AFTER',
  POD = 'POD',
  CLAIM = 'CLAIM',
  // [Inc-17] A dry-clean catalog item photo (org-scoped, not order-tied) — uploaded through the same
  // presigned media seam, stored as Service.imageKey.
  CATALOG = 'CATALOG',
}

/** Presigned-upload intent lifecycle (Increment 10): a presign creates PENDING; confirm (after a real
 *  HEAD verification) flips it CONFIRMED and links the created Photo. PENDING rows whose object never
 *  landed are the reconciliation/orphan-cleanup set. */
export enum MediaUploadStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
}

/** [§9 LITERAL] Quote.status (§9.3: draft|sent|approved|declined|expired). */
export enum QuoteStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
}

/**
 * [DERIVED] CustodyEvent.stage (§8.2, §9.3). Append-only scan stage.
 * Stage names are grounded in the §5.1 narrative ("dusting/wash/dry/finish")
 * and the §5.4 logistics backbone.
 */
export enum CustodyStage {
  PICKED_UP = 'PICKED_UP',
  INTAKE = 'INTAKE',
  INSPECTED = 'INSPECTED',
  DUSTING = 'DUSTING',
  WASH = 'WASH',
  DRY = 'DRY',
  FINISH = 'FINISH',
  QC = 'QC',
  READY = 'READY',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
}

// Track-B (care homes) — the resident personal-clothing lifecycle (PRD §5.2-B). Values map the PRD
// states EXACTLY; used as both the garment's denormalized status (Item.garmentStatus) and the
// append-only custody checkpoint (CustodyEvent.garmentStage). Mirrors the Prisma `GarmentStatus`.
export enum GarmentStatus {
  GARMENT_ENROLLED = 'GARMENT_ENROLLED',
  SOIL_PICKUP = 'SOIL_PICKUP',
  INTAKE_SORT = 'INTAKE_SORT',
  WASH = 'WASH',
  RETURN_SORT = 'RETURN_SORT',
  DELIVERED_TO_RESIDENT = 'DELIVERED_TO_RESIDENT',
  LOST_FOUND_POOL = 'LOST_FOUND_POOL',
  RECONCILE = 'RECONCILE',
}

export enum ResidentStatus {
  ACTIVE = 'ACTIVE',
  DISCHARGED = 'DISCHARGED',
}

export enum LostFoundStatus {
  OPEN = 'OPEN',
  RECONCILED = 'RECONCILED',
}

// ─────────────────────────── Logistics & tracking ──────────────────────────

/** [DERIVED] Vehicle.status (§9.5). */
export enum VehicleStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  MAINTENANCE = 'MAINTENANCE',
}

/** [DERIVED] Shift.status (§9.5). Location emits only while ACTIVE (§6.2, §12.2). */
export enum ShiftStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
}

/** [DERIVED] Route.status (§9.5). Route is not a §5 state machine; §5.4 governs RouteStop. */
export enum RouteStatus {
  PLANNED = 'PLANNED',
  PUBLISHED = 'PUBLISHED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** [§9 LITERAL] RouteStop.kind (§9.5: pickup|delivery|both). */
export enum RouteStopKind {
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
  BOTH = 'BOTH',
}

/**
 * [DERIVED — Track A] RouteStop.stop_kind — concierge/lobby handoff (condo B2B, PRD §14).
 * Orthogonal to {@link RouteStopKind} (the pickup/delivery operation): this marks WHERE the
 * handoff happens — a single building concierge/lobby point vs an individual unit/address.
 */
export enum RouteStopHandoff {
  DIRECT = 'DIRECT',
  CONCIERGE = 'CONCIERGE',
}

/**
 * [§5 NORMATIVE] RouteStop lifecycle — PRD §5.4 (also §9.5).
 *   PENDING → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED|FAILED|SKIPPED
 */
export enum RouteStopStatus {
  PENDING = 'PENDING',
  EN_ROUTE = 'EN_ROUTE',
  ARRIVED = 'ARRIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

/** [§9 LITERAL] GeofenceEvent.type (§9.5: approaching|arrived|departed). */
export enum GeofenceEventType {
  APPROACHING = 'APPROACHING',
  ARRIVED = 'ARRIVED',
  DEPARTED = 'DEPARTED',
}

// ──────────────────────────── Billing, comms, sys ──────────────────────────

/** [DERIVED] Invoice.status (§9.6). */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  VOID = 'VOID',
}

/**
 * [DERIVED — Track A] Account.billing_mode — per-account billing terms (PRD §9.1).
 * PER_ORDER = one invoice per order (Inc-12 specialty default); BATCH_PERIODIC = one periodic
 * invoice batching a period's billable orders (B2B building account). Cost-center splits = Phase 2.
 */
export enum BillingMode {
  PER_ORDER = 'PER_ORDER',
  BATCH_PERIODIC = 'BATCH_PERIODIC',
}

/**
 * [DERIVED — Track A] StandingOrder.cadence — recurring-order cadence (RRULE-lite, PRD §9.2/§14).
 * WEEKLY/BIWEEKLY anchored on a weekday; full RRULE + par/soil/pack-to-par stay deferred (Phase 2).
 */
export enum StandingOrderCadence {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
}

/**
 * [DERIVED — Track A Phase 2] CostCenter.kind — the taxonomy of a condo/B2B billing group
 * (PRD §B4.1/§A5.2 "groups attached to the condominium"). A building's billing can be split by
 * physical division (WING/FLOOR), funding line (FUNDING — e.g. reserve fund vs operating), or
 * amenity-vs-resident (AMENITY). OTHER is the honest escape hatch; the field is nullable (an
 * unclassified cost centre is allowed). Attribution is orthogonal metadata — it never touches the
 * §5.1 order spine.
 */
export enum CostCenterKind {
  WING = 'WING',
  FLOOR = 'FLOOR',
  FUNDING = 'FUNDING',
  AMENITY = 'AMENITY',
  OTHER = 'OTHER',
}

/**
 * [Track B Phase 2 — PRD §2.2/§5.2/§B3] Facility-linen on-hand ledger movement reason. Mirrors the Prisma
 * `LinenMovementType`. The append-only LinenMovement carries a SIGNED qty: SOIL_PICKUP −, DELIVERY +,
 * ADJUSTMENT ± (the "set on-hand to T" delta). on_hand == Σ(qty) per (site, cost-centre?, sku).
 */
export enum LinenMovementType {
  SOIL_PICKUP = 'SOIL_PICKUP',
  DELIVERY = 'DELIVERY',
  ADJUSTMENT = 'ADJUSTMENT',
}

/**
 * [Track B Phase 2 — PRD §B3.2] Manifest purpose. Mirrors the Prisma `ManifestKind`. PICKUP_CHECKLIST is
 * the existing specialty load sheet (default); PACK_TO_PAR is the care-home facility-linen load sheet
 * (par − on-hand per SKU, per site/cost-centre).
 */
export enum ManifestKind {
  PICKUP_CHECKLIST = 'PICKUP_CHECKLIST',
  PACK_TO_PAR = 'PACK_TO_PAR',
}

/** [DERIVED] Payment.method (§8.4 lists card/wallets/ACH/PAD). */
export enum PaymentMethod {
  CARD = 'CARD',
  APPLE_PAY = 'APPLE_PAY',
  GOOGLE_PAY = 'GOOGLE_PAY',
  ACH = 'ACH',
  PAD = 'PAD',
  CASH = 'CASH',
}

/** [DERIVED] Payment.status (§9.6). */
export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

/** [DERIVED] Refund.status (Increment 12). Mirrors Stripe refund status. */
export enum RefundStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

/** [DERIVED] Dispute.status (Increment 12). Maps from the Stripe charge.dispute lifecycle. */
export enum DisputeStatus {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  WON = 'WON',
  LOST = 'LOST',
  CLOSED = 'CLOSED',
}

/** [§9 LITERAL] Claim/CreditNote.type (§9.6: damage|loss|service). */
export enum ClaimType {
  DAMAGE = 'DAMAGE',
  LOSS = 'LOSS',
  SERVICE = 'SERVICE',
}

/** [DERIVED] Claim.status (§9.6). Mirrors §5.1 CLAIM_OPENED → CLAIM_RESOLVED. */
export enum ClaimStatus {
  OPEN = 'OPEN',
  APPROVED = 'APPROVED',
  DENIED = 'DENIED',
  RESOLVED = 'RESOLVED',
}

/** [DERIVED] Message/Notification.channel (§8.5: push/sms/email; WhatsApp is P2). */
export enum CommsChannel {
  PUSH = 'PUSH',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
}

/** [DERIVED] Notification.status (§9.6; Increment 8 adds the outbox lifecycle states). */
export enum NotificationStatus {
  PENDING = 'PENDING',
  RETRYING = 'RETRYING', // a transport attempt failed; a bounded retry is scheduled
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  SUPPRESSED = 'SUPPRESSED', // deliberately not sent — opt-out or (config) quiet-hours
}

/** [DERIVED] Device.platform (§9.6). */
export enum DevicePlatform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  WEB = 'WEB',
}
