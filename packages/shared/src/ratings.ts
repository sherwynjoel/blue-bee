/**
 * Ratings / CSAT contract (Increment 32, PRD A6.3) — the post-delivery customer rating. Single source of
 * truth for the API (validation), the console (analytics), and the customer app (submit + eligibility).
 *
 * Order-level: one 1–5 `score` + an optional free-text `comment` per order. NO per-item breakdown — we
 * gather no per-item quality signal, so we won't render one (honesty firewall). Rateable once the order has
 * reached DELIVERED (delivered-or-later); the original submitter may revise within 30 days.
 */
import { z } from 'zod';
import { OrderStatus } from './enums';

// ───────────────────────────── eligibility (delivered-or-later) ─────────────────────────────

/**
 * Order statuses at/after DELIVERED — the window in which an order may be rated (§5.1). An INVOICED,
 * CLAIM_*, or CLOSED order is still rateable (the work was delivered); a mid-fulfilment one is not. Kept
 * here so the API gate and the customer app's CTA agree on exactly one definition of "rateable".
 */
export const RATEABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DELIVERED,
  OrderStatus.INVOICED,
  OrderStatus.CLAIM_OPENED,
  OrderStatus.CLAIM_RESOLVED,
  OrderStatus.CLOSED,
]);

/** True once an order has reached DELIVERED (delivered-or-later) — the rating eligibility gate. */
export function isOrderRateable(status: OrderStatus): boolean {
  return RATEABLE_ORDER_STATUSES.has(status);
}

/** How long after creation the original submitter may still revise their rating. */
export const RATING_EDIT_WINDOW_DAYS = 30;

// ───────────────────────────── request schemas ─────────────────────────────

const scoreSchema = z.number().int().min(1).max(5);

/** POST body — a new rating: a required 1–5 score + an optional comment (≤1000 chars, trimmed). */
export const createRatingSchema = z.object({
  score: scoreSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type CreateRatingDto = z.infer<typeof createRatingSchema>;

/** PATCH body — revise the score and/or comment (at least one). `comment: null` clears it. */
export const patchRatingSchema = z
  .object({
    score: scoreSchema.optional(),
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((d) => d.score !== undefined || d.comment !== undefined, {
    message: 'provide a new score and/or comment',
  });
export type PatchRatingDto = z.infer<typeof patchRatingSchema>;

// ───────────────────────────── response ─────────────────────────────

/** A rating as returned to clients. */
export interface RatingView {
  id: string;
  orderId: string;
  score: number;
  comment: string | null;
  submittedByUserId: string;
  createdAt: string;
  updatedAt: string;
  /** True while the rating is still within the edit window (the ORIGINAL submitter may revise it). */
  editable: boolean;
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const RATING_ERRORS = {
  RATING_ALREADY_EXISTS: 'rating.already_exists',
  ORDER_NOT_RATEABLE: 'rating.order_not_rateable',
  NOT_ORDER_CUSTOMER: 'rating.not_order_customer',
  RATING_NOT_FOUND: 'rating.not_found',
  RATING_NOT_YOURS: 'rating.not_yours',
  EDIT_WINDOW_CLOSED: 'rating.edit_window_closed',
} as const;
export type RatingErrorCode = (typeof RATING_ERRORS)[keyof typeof RATING_ERRORS];
