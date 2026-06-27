/**
 * B2B self-serve invoice portal contract (Track A) — the account-admin/staff surface for VIEWING and
 * PAYING their building account's invoices. Zod request schemas + `z.infer` DTO types + plain view
 * interfaces + a frozen error-code map, mirroring `accounts.ts`/`recurring.ts`.
 *
 * The full invoice detail (lines + the cost-centre split) reuses `InvoiceView`/`InvoiceLineView` from
 * `./payments`; this file adds the cursor-paginated LIST shapes + the portal error codes. Money crosses
 * the wire as fixed-2 dollar strings (the Decimal(12,2) form); the pay amount is ALWAYS computed
 * server-side from the invoice total (incl. HST) — the request body carries no money.
 */
import { z } from 'zod';
import { InvoiceStatus } from './enums';

// ───────────────────────────── requests ─────────────────────────────

/** List the caller's invoices (cursor-paginated). `status` optionally narrows by lifecycle state. */
export const listInvoicesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(InvoiceStatus).optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

/**
 * Pay an invoice. Carries NO money — the charge is the invoice total (incl. HST), computed server-side.
 * An optional correlation note rides along for audit only (never affects the amount).
 */
export const payInvoiceSchema = z.object({
  note: z.string().max(500).optional(),
});
export type PayInvoiceDto = z.infer<typeof payInvoiceSchema>;

// ───────────────────────────── responses / view shapes ─────────────────────────────

/** A row in the invoice list (summary only — no lines; the detail read carries lines + the split). */
export interface InvoiceListItemView {
  id: string;
  accountId: string;
  orderId: string | null;
  number: string | null;
  status: InvoiceStatus;
  /** Fixed-2 dollar string incl. HST. */
  total: string;
  currency: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

/** A cursor page of the caller's invoices. */
export interface InvoiceListResult {
  invoices: InvoiceListItemView[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const INVOICE_PORTAL_ERRORS = {
  /** Out-of-scope or nonexistent invoice id (cross-org or — on reads — cross-account): 404. */
  INVOICE_NOT_FOUND: 'invoices.invoice_not_found',
  /** A cross-ACCOUNT invoice within the caller's own org, on the pay (write) gate: 403. */
  CROSS_ACCOUNT_FORBIDDEN: 'invoices.cross_account_forbidden',
  /** The invoice is not in a payable state (only ISSUED/OVERDUE may be paid): 409. */
  NOT_PAYABLE: 'invoices.not_payable',
  /** The invoice is already PAID: 409. */
  ALREADY_PAID: 'invoices.already_paid',
} as const;
export type InvoicePortalErrorCode = (typeof INVOICE_PORTAL_ERRORS)[keyof typeof INVOICE_PORTAL_ERRORS];
