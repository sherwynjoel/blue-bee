/**
 * Track-A (condo B2B) recurring/standing-order + per-account-billing contract — Zod request schemas,
 * DTO types, view shapes, and problem+json error codes (PRD §9.2 StandingOrder, §14 recurring route
 * auto-generation, §9.1 Account.billing_terms, §11 BILLING `POST /invoices:batch`).
 *
 * Wire shapes only. The generation job, the route auto-gen (reusing the Inc-4 PostGIS sequencer), the
 * idempotency ledger, and the batch-invoicing path live in `apps/api/src/recurring`. Cost-center split
 * billing + par/soil/pack-to-par stay DEFERRED (Phase 2 — modeled-for, not built/faked).
 */
import { z } from 'zod';
import { BillingMode, OrderVertical, StandingOrderCadence } from './enums';

// ───────────────────────────── primitives ─────────────────────────────

/** A local time-of-day "HH:MM" (24h). Applied to an occurrence date to build the pickup window. */
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24h HH:MM time-of-day');

/** A standing-order pickup window as local times-of-day; `end` must be strictly after `start`. */
export const pickupWindowSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((w) => w.start < w.end, { message: 'pickup window end must be after start' });
export type PickupWindow = z.infer<typeof pickupWindowSchema>;

/** A weekday: 0=Sunday … 6=Saturday (matches JS Date.getUTCDay / our DST-safe occurrence math). */
const weekdaySchema = z.number().int().min(0).max(6);

/** A calendar date (YYYY-MM-DD) — coerced to a UTC-midnight Date for a Prisma `@db.Date` column. */
const dateOnlySchema = z.coerce.date();

// ───────────────────────────── standing orders ─────────────────────────────

export const createStandingOrderSchema = z
  .object({
    accountId: z.string().uuid(),
    siteId: z.string().uuid(),
    serviceId: z.string().uuid(),
    vertical: z.nativeEnum(OrderVertical).default(OrderVertical.SPECIALTY),
    cadence: z.nativeEnum(StandingOrderCadence),
    weekday: weekdaySchema,
    pickupWindow: pickupWindowSchema,
    /** True ⇒ the generated pickup is a single building concierge/lobby handoff. */
    concierge: z.boolean().default(false),
    /** Track-A Phase 2: a cost centre the generated orders inherit (split-billing attribution). */
    costCenterId: z.string().uuid().nullable().optional(),
    startsOn: dateOnlySchema,
    endsOn: dateOnlySchema.optional(),
    active: z.boolean().default(true),
  })
  .refine((d) => d.endsOn === undefined || d.endsOn >= d.startsOn, {
    message: 'endsOn must be on or after startsOn',
    path: ['endsOn'],
  });
export type CreateStandingOrderDto = z.infer<typeof createStandingOrderSchema>;

export const updateStandingOrderSchema = z
  .object({
    cadence: z.nativeEnum(StandingOrderCadence).optional(),
    weekday: weekdaySchema.optional(),
    pickupWindow: pickupWindowSchema.optional(),
    concierge: z.boolean().optional(),
    active: z.boolean().optional(),
    /** Track-A Phase 2: re-point (or clear with `null`) the cost centre generated orders inherit. */
    costCenterId: z.string().uuid().nullable().optional(),
    endsOn: dateOnlySchema.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateStandingOrderDto = z.infer<typeof updateStandingOrderSchema>;

/**
 * Trigger one generation pass. `asOf` (an ISO instant) makes a run deterministic for tests/back-fill
 * (defaults to now server-side); `standingOrderId` scopes the pass to a single standing order.
 */
export const runGenerationSchema = z
  .object({
    asOf: z.string().datetime().optional(),
    standingOrderId: z.string().uuid().optional(),
  })
  .default({});
export type RunGenerationDto = z.infer<typeof runGenerationSchema>;

export const listStandingOrdersQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  accountId: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
});
export type ListStandingOrdersQuery = z.infer<typeof listStandingOrdersQuerySchema>;

// ───────────────────────────── per-account billing terms ─────────────────────────────

export const setBillingTermsSchema = z.object({
  billingMode: z.nativeEnum(BillingMode),
  /** Net-terms due window (days) for a BATCH_PERIODIC invoice. 0 ⇒ due on issue. */
  netDays: z.number().int().min(0).max(365).default(0),
});
export type SetBillingTermsDto = z.infer<typeof setBillingTermsSchema>;

/**
 * Generate ONE periodic invoice batching an account's billable orders delivered in `[from, to)`.
 * `period` is an optional human label (e.g. "2026-06"); when omitted it is derived from the window.
 * Idempotent per (account, window) — a re-run returns the existing batch invoice.
 */
export const batchInvoiceSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    period: z.string().min(1).max(40).optional(),
  })
  .refine((d) => new Date(d.from) < new Date(d.to), { message: 'from must be strictly before to' });
export type BatchInvoiceDto = z.infer<typeof batchInvoiceSchema>;

// ───────────────────────────── view shapes ─────────────────────────────

export interface StandingOrderView {
  id: string;
  accountId: string;
  siteId: string;
  serviceId: string;
  vertical: OrderVertical;
  cadence: StandingOrderCadence;
  weekday: number;
  pickupWindow: PickupWindow;
  concierge: boolean;
  /** Track-A Phase 2: cost centre generated orders inherit (split-billing attribution), or null. */
  costCenterId: string | null;
  active: boolean;
  startsOn: string; // YYYY-MM-DD
  endsOn: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export interface StandingOrderOccurrenceView {
  id: string;
  standingOrderId: string;
  periodKey: string; // the occurrence date (YYYY-MM-DD)
  orderId: string | null;
  routeId: string | null;
  generatedAt: string;
}

/** Counts returned by one generation pass — every number is a real row count (honesty firewall). */
export interface GenerationResult {
  asOf: string;
  standingOrdersConsidered: number;
  occurrencesCreated: number;
  ordersCreated: number;
  routesCreated: number;
  /** Standing-order occurrences whose orders were generated but whose route auto-gen degraded. */
  routeFailures: number;
}

export interface BillingTermsView {
  accountId: string;
  billingMode: BillingMode;
  billingNetDays: number;
}

/** Generated orders + routes for an account (the lean B2B-console feed; the web view is a follow-on). */
export interface GeneratedForAccountView {
  accountId: string;
  occurrences: StandingOrderOccurrenceView[];
  orderCount: number;
  routeCount: number;
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const RECURRING_ERRORS = {
  STANDING_ORDER_NOT_FOUND: 'recurring.standing_order_not_found',
  ACCOUNT_NOT_FOUND: 'recurring.account_not_found',
  SITE_NOT_FOUND: 'recurring.site_not_found',
  SERVICE_NOT_FOUND: 'recurring.service_not_found',
  SITE_ACCOUNT_MISMATCH: 'recurring.site_account_mismatch',
  NO_BILLABLE_ORDERS: 'recurring.no_billable_orders',
  NOT_BATCH_ACCOUNT: 'recurring.not_batch_account',
} as const;
export type RecurringErrorCode = (typeof RECURRING_ERRORS)[keyof typeof RECURRING_ERRORS];
