/**
 * Cost-center split-billing contract (Track A Phase 2 — PRD §B4.1 cost-centre hierarchy, §A5.2 splits,
 * §B5.2 cost-centre export, §8.4 billing). Zod request schemas + derived DTO types, view shapes, and
 * problem+json error codes for: cost-centre CRUD (under an Account, optionally scoped to a Site), order
 * attribution, and the split-billing breakdown + period report/CSV.
 *
 * Wire shapes only — the CRUD, the attribution gate, and the split-billing engine (which groups an
 * account's invoiced lines by cost centre and writes a reconciling `Invoice.costCenterBreakdown`) live
 * in `apps/api/src/cost-centers` and `apps/api/src/recurring`. A cost centre lives UNDER ONE Account
 * (the condominium = one BUSINESS Account → Sites → Cost Centres) — it is NOT a parent-of-accounts.
 * Money crosses the wire as fixed-2 dollar strings (the Decimal(12,2) form), HST derived by the engine.
 */
import { z } from 'zod';
import { CostCenterKind } from './enums';

// ───────────────────────────── cost-centre CRUD ─────────────────────────────

/**
 * Create a cost centre under an account (the `:accountId` is the path param — never the body). `code`
 * is the stable, human-facing key, unique per account (a re-used code → 409). An optional `siteId`
 * scopes the centre to one tower/site (validated to belong to the account).
 */
export const createCostCenterSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  kind: z.nativeEnum(CostCenterKind).optional(),
  siteId: z.string().uuid().optional(),
});
export type CreateCostCenterDto = z.infer<typeof createCostCenterSchema>;

/** Rename / re-classify / activate-deactivate a cost centre. `code` is immutable (the stable key). */
export const updateCostCenterSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    kind: z.nativeEnum(CostCenterKind).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateCostCenterDto = z.infer<typeof updateCostCenterSchema>;

export const listCostCentersQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
});
export type ListCostCentersQuery = z.infer<typeof listCostCentersQuerySchema>;

// ───────────────────────────── attribution ─────────────────────────────

/**
 * Attach (or detach with `null`) a cost centre to an order — orthogonal metadata, it never moves the
 * §5.1 order state. The centre must belong to the order's account (else 400 account_mismatch).
 */
export const attachOrderCostCenterSchema = z.object({
  costCenterId: z.string().uuid().nullable(),
});
export type AttachOrderCostCenterDto = z.infer<typeof attachOrderCostCenterSchema>;

// ───────────────────────────── period report ─────────────────────────────

/** Per-cost-centre totals over `[from, to)` (orders by created-at, mirroring the batch-invoice window). */
export const costCenterReportQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .refine((d) => new Date(d.from) < new Date(d.to), { message: 'from must be strictly before to' });
export type CostCenterReportQuery = z.infer<typeof costCenterReportQuerySchema>;

// ───────────────────────────── view shapes ─────────────────────────────

export interface CostCenterView {
  id: string;
  accountId: string;
  siteId: string | null;
  code: string;
  name: string;
  kind: CostCenterKind | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostCenterListResult {
  costCenters: CostCenterView[];
}

/** The cost centre an order is attributed to (or `null` when detached). */
export interface OrderCostCenterView {
  orderId: string;
  accountId: string;
  costCenterId: string | null;
}

/**
 * One split line of an invoice's `costCenterBreakdown` (PRD §A5.2). `costCenterId` is `null` for the
 * explicit "Unassigned" bucket (orders with no cost centre — honest, never silently dropped). The split
 * subtotals/taxes/totals SUM EXACTLY to the invoice subtotal/tax/total (integer-cents partition).
 */
export interface CostCenterBreakdownEntry {
  costCenterId: string | null;
  code: string;
  name: string;
  subtotal: string;
  tax: string;
  total: string;
}

/** One row of the period report (per cost centre, plus the "Unassigned" bucket). */
export interface CostCenterReportRow {
  costCenterId: string | null;
  code: string;
  name: string;
  kind: CostCenterKind | null;
  orderCount: number;
  subtotal: string;
  tax: string;
  total: string;
}

export interface CostCenterReportView {
  accountId: string;
  from: string;
  to: string;
  currency: string;
  rows: CostCenterReportRow[];
  grandTotal: { subtotal: string; tax: string; total: string };
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const COST_CENTER_ERRORS = {
  COST_CENTER_NOT_FOUND: 'cost_centers.cost_center_not_found',
  ACCOUNT_NOT_FOUND: 'cost_centers.account_not_found',
  SITE_NOT_FOUND: 'cost_centers.site_not_found',
  SITE_ACCOUNT_MISMATCH: 'cost_centers.site_account_mismatch',
  ORDER_NOT_FOUND: 'cost_centers.order_not_found',
  ACCOUNT_MISMATCH: 'cost_centers.account_mismatch',
  DUPLICATE_CODE: 'cost_centers.duplicate_code',
} as const;
export type CostCenterErrorCode = (typeof COST_CENTER_ERRORS)[keyof typeof COST_CENTER_ERRORS];
