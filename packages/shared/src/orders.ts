/**
 * Order/quote contract (Increment 3) — Zod request schemas + derived DTO types for
 * the specialty order endpoints (PRD §11.1 CUSTOMER/PRODUCTION rows, §8.3, §5.1).
 *
 * Single source of truth shared by the API (validation) and, later, the client apps.
 * The state machine itself lives in `lifecycle.ts` (`canTransitionOrder`); these are
 * the wire shapes for book → intake/inspection → quote → approve/decline.
 */
import { z } from 'zod';
import { ItemKind, PhotoKind, OrderStatus } from './enums';
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
} as const;
export type OrderErrorCode = (typeof ORDER_ERRORS)[keyof typeof ORDER_ERRORS];
