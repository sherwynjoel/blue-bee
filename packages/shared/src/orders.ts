/**
 * Order/quote contract (Increment 3) — Zod request schemas + derived DTO types for
 * the specialty order endpoints (PRD §11.1 CUSTOMER/PRODUCTION rows, §8.3, §5.1).
 *
 * Single source of truth shared by the API (validation) and, later, the client apps.
 * The state machine itself lives in `lifecycle.ts` (`canTransitionOrder`); these are
 * the wire shapes for book → intake/inspection → quote → approve/decline.
 */
import { z } from 'zod';
import { ItemKind, PhotoKind, OrderStatus, WeighPoint } from './enums';
import { geoPointSchema, timeWindowSchema } from './validators';

/** Free-form measurement bag persisted to Item.measurements (sqft, pieces, weightLb, dims…). */
export const measurementsSchema = z.record(z.union([z.number(), z.string(), z.boolean()]));
export type Measurements = z.infer<typeof measurementsSchema>;

/** A single upcharge line (PRD §8.3 "+ upcharges"). amount is a positive add-on in dollars. */
export const upchargeSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  amount: z.number().nonnegative().finite(),
});
export type Upcharge = z.infer<typeof upchargeSchema>;

// ─────────────────────────────── book (POST /v1/orders) ───────────────────────────────

/** One specialty item being booked (PRD §7A A2.1 — type + optional photo + notes). */
export const bookItemSchema = z.object({
  kind: z.nativeEnum(ItemKind),
  serviceId: z.string().uuid(),
  /** Rough size used only for the pre-intake estimate range (final measure comes from intake). */
  estimatedMeasure: z.number().positive().finite().optional(),
  measurements: measurementsSchema.optional(),
  notes: z.string().max(1000).optional(),
  /** Optional pre-printed tag code; otherwise the server mints one. */
  tagCode: z.string().min(1).max(64).optional(),
  // Reference/BEFORE photos attach AFTER booking via the real presigned-upload flow
  // (POST /v1/media/presign → PUT → /v1/media/confirm, Increment 10) — no register-a-URL at book time.
});
export type BookItemDto = z.infer<typeof bookItemSchema>;

export const bookOrderSchema = z.object({
  accountId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
  pickupWindow: timeWindowSchema.optional(),
  notes: z.string().max(2000).optional(),
  // [Inc-15 corporate pricing] Optional service-address point for the pickup. When present it drives
  // BUILDING-MATCH pricing (the condo path): a point inside a corporate building's boundary prices the
  // order on that corporate account's rate card while the member still pays individually. Optional ⇒
  // existing callers (and the unchanged customer app) are unaffected; no match ⇒ default pricing.
  serviceGeo: geoPointSchema.optional(),
  items: z.array(bookItemSchema).min(1).max(50),
});
export type BookOrderDto = z.infer<typeof bookOrderSchema>;

// ─────────────────────────── list (GET /v1/orders) — cursor pagination ───────────────────────────

export const listOrdersQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(OrderStatus).optional(),
  /**
   * Track-A B2B portal — optionally confine the listing to ONE account (additive; the existing
   * row-scope + cursor are preserved). The account-scoped `GET /v1/accounts/:accountId/orders`
   * delegates to the same service with this set, so there is no duplicated listing logic.
   */
  accountId: z.string().uuid().optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// ───────────────────── received-at-plant / schedule-pickup (staff transitions) ─────────────────────

export const schedulePickupSchema = z.object({ pickupWindow: timeWindowSchema });
export type SchedulePickupDto = z.infer<typeof schedulePickupSchema>;

export const receivedAtPlantSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type ReceivedAtPlantDto = z.infer<typeof receivedAtPlantSchema>;

// ───────────────────── intake / inspection (POST …/items/:itemId/inspection) ─────────────────────

export const inspectionSchema = z
  .object({
    conditionCodes: z.array(z.string().min(1).max(64)).max(50).default([]),
    notes: z.string().max(2000).optional(),
    /** Measured values captured at intake (sqft for rugs, pieces for blinds, …). */
    measurements: measurementsSchema,
    preexistingDamage: z.boolean().default(false),
    /** Customer acknowledgement of pre-existing damage (in-app / on device — §5.1). */
    customerAck: z.boolean().optional(),
    /** Who acknowledged (defaults to the acting principal if omitted). */
    ackBy: z.string().uuid().optional(),
    /** Damage evidence photo: the id of a Photo already uploaded for this item via the real
     *  presigned-upload flow (POST /v1/media/presign → PUT → /v1/media/confirm). Required when flagged. */
    damagePhotoId: z.string().uuid().optional(),
  })
  .refine((d) => Object.keys(d.measurements).length > 0, {
    message: 'measurements must capture at least one measured value at intake',
    path: ['measurements'],
  })
  .refine((d) => !d.preexistingDamage || (d.customerAck === true && !!d.damagePhotoId), {
    message: 'preexistingDamage requires customerAck=true and a damagePhotoId (uploaded photo + ack per §5.1)',
    path: ['preexistingDamage'],
  });
export type InspectionDto = z.infer<typeof inspectionSchema>;

// ───────────────────── quote build (POST …/quote) ─────────────────────

export const quoteBuildSchema = z.object({
  /** Optional per-item upcharges added on top of measure × rate. */
  upcharges: z
    .array(upchargeSchema.extend({ itemId: z.string().uuid() }))
    .max(200)
    .default([]),
  /** Manual adjustment to the subtotal (negative = discount). Reason is audited (§8.3). */
  manualAdjustment: z
    .object({ reason: z.string().min(3).max(500), amount: z.number().finite() })
    .optional(),
  expiresInDays: z.number().int().positive().max(365).default(14),
});
export type QuoteBuildDto = z.infer<typeof quoteBuildSchema>;

// ───────────────────── approve / decline / hold / resume ─────────────────────

export const approveQuoteSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type ApproveQuoteDto = z.infer<typeof approveQuoteSchema>;

export const declineQuoteSchema = z
  .object({ reason: z.string().max(500).optional(), returnWindow: timeWindowSchema.optional() })
  .default({});
export type DeclineQuoteDto = z.infer<typeof declineQuoteSchema>;

export const holdOrderSchema = z.object({ reason: z.string().min(3).max(500) });
export type HoldOrderDto = z.infer<typeof holdOrderSchema>;

export const resumeOrderSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type ResumeOrderDto = z.infer<typeof resumeOrderSchema>;

// ───────────────────── production / plant transitions (Inc-30 — §5.1 back-half) ─────────────────────

/**
 * [Inc-30] The plant half of the §5.1 spine that was never wired: QUOTE_APPROVED → IN_CLEANING → QC →
 * READY, plus the REWASH branch the lifecycle already permits (IN_CLEANING⇄REWASH, QC→REWASH). Every step
 * is a human-triggered, atomic, audited OrderStateMachine transition (no timers, no auto-advance) — these
 * are the wire shapes the console posts. All target states already exist in `OrderStatus`; nothing new is
 * invented, only the transitions that were dead code are now driven.
 */

/** Start (QUOTE_APPROVED) or restart (REWASH) cleaning → IN_CLEANING. */
export const startCleaningSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type StartCleaningDto = z.infer<typeof startCleaningSchema>;

/** Move a cleaned order to quality control → IN_CLEANING → QC. */
export const sendToQcSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type SendToQcDto = z.infer<typeof sendToQcSchema>;

/**
 * Record the QC decision — QC → READY (pass) or QC → REWASH (fail). A failure must carry a reason so the
 * rewash is accountable (audited), never a silent bounce; a pass may carry an optional note.
 */
export const recordQcSchema = z
  .object({
    result: z.enum(['pass', 'fail']),
    reason: z.string().min(3).max(500).optional(),
  })
  .refine((d) => d.result === 'pass' || (d.reason !== undefined && d.reason.trim().length >= 3), {
    message: 'a QC failure requires a reason (why the order is sent back for rewash)',
    path: ['reason'],
  });
export type RecordQcDto = z.infer<typeof recordQcSchema>;

/** Pull a load back for a rewash cycle mid-cleaning → IN_CLEANING → REWASH (the QC-fail path is `recordQc`). */
export const rewashSchema = z.object({ reason: z.string().min(3).max(500) });
export type RewashDto = z.infer<typeof rewashSchema>;

// ───────────────────── weight capture (POST …/weigh) — Increment 22 ─────────────────────

/**
 * [Inc-22] A driver/plant weight approval → an APPEND-ONLY WeightCapture. `weightKg` is the approved
 * actual (overrides any customer estimate); `weighPoint` = PICKUP or PLANT; `itemId` targets a specific
 * line item (omit for a single-line order → the server resolves the one weighable line). The mutation
 * carries an Idempotency-Key (drivers re-submit on flaky networks) — a repeat with the same key returns
 * the first capture, a NEW key writes a NEW (re-weigh) capture; the old capture is never mutated.
 */
export const captureWeightSchema = z.object({
  weightKg: z.number().positive().max(100000),
  weighPoint: z.nativeEnum(WeighPoint),
  itemId: z.string().uuid().optional(),
  /** Free-form provenance: 'driver' | 'plant' | 'owner_adjustment' (audited). */
  source: z.string().trim().min(1).max(40).optional(),
  note: z.string().trim().max(500).optional(),
});
export type CaptureWeightDto = z.infer<typeof captureWeightSchema>;

/** One append-only weight capture row (newest first in the history). */
export interface WeightCaptureView {
  id: string;
  orderId: string;
  itemId: string | null;
  weightKg: string;
  weighPoint: WeighPoint;
  capturedByUserId: string | null;
  capturedAt: string;
  source: string | null;
  note: string | null;
}

/** What the pricing gate did after an approved weight/measure. */
export type WeighPricingStatus = 'auto_approved' | 'quote_sent' | 'none';

/** Result of a weigh: the new capture, the current authoritative weight, and the pricing outcome. */
export interface WeightCaptureResult {
  capture: WeightCaptureView;
  /** The authoritative weight for the order/item = the most recent capture (this one). */
  authoritativeWeightKg: string;
  pricing: {
    status: WeighPricingStatus;
    /** Quote total (decimal string) when priced, else null. */
    total: string | null;
    currency: string;
    /** True when the FROM_MEASURED specialty gate left a quote awaiting customer approval. */
    awaitsCustomerApproval: boolean;
    orderStatus: OrderStatus;
  };
}

/** GET …/weight — the authoritative weight + the full append-only capture history for an order. */
export interface OrderWeightView {
  orderId: string;
  authoritativeWeightKg: string | null;
  authoritativeWeighPoint: WeighPoint | null;
  captures: WeightCaptureView[];
  /**
   * [Inc-23] The customer's booking estimate (the order's total estimated measure entered at book time,
   * e.g. an estimated wash weight in kg), or null when none was given. Shown to the driver as a reference
   * before they weigh — the approved actual always overrides it.
   */
  customerEstimate: number | null;
}

// ───────────────────── shared error codes (problem+json `title`) ─────────────────────

export const ORDER_ERRORS = {
  ILLEGAL_TRANSITION: 'illegal_transition',
  ORDER_NOT_FOUND: 'order_not_found',
  ITEM_NOT_FOUND: 'item_not_found',
  CROSS_ACCOUNT_FORBIDDEN: 'cross_account_forbidden',
  QUOTE_NOT_FOUND: 'quote_not_found',
  QUOTE_EXPIRED: 'quote_expired',
  QUOTE_NOT_SENT: 'quote_not_sent',
  MEASURE_MISSING: 'measure_missing',
  INVALID_MEDIA_URL: 'invalid_media_url',
  INVALID_BOOKING: 'invalid_booking',
  // [Inc-22] weight capture
  WEIGH_ITEM_AMBIGUOUS: 'weigh_item_ambiguous',
  WEIGH_NOT_WEIGHABLE: 'weigh_not_weighable',
} as const;
export type OrderErrorCode = (typeof ORDER_ERRORS)[keyof typeof ORDER_ERRORS];
