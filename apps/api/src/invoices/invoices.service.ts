import { Injectable, NotFoundException } from '@nestjs/common';
import {
  INVOICE_PORTAL_ERRORS,
  type InvoiceListItemView,
  type InvoiceListResult,
  type InvoiceView,
  type ListInvoicesQuery,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { decimalMoney } from '../orders/money';
import { parseStoredBreakdown } from '../cost-centers/cost-center-split';
import { InvoicePdfService } from './invoice-pdf.service';

/** The invoice + its account header (billing terms) — what the detail/PDF render from. */
export type InvoiceForStatement = NonNullable<Awaited<ReturnType<InvoicesService['getEntity']>>>;

/**
 * Account-admin self-serve invoice READS (Track A — the B2B portal). `GET /v1/invoices` (the caller's
 * own account's invoices, cursor-paginated) + `GET /v1/invoices/:id` (header + lines + the cost-centre
 * split). Confinement is enforced by `scopedPrisma` — `Invoice` is an ACCOUNT_DIRECT model, so an
 * ACCOUNT_ADMIN/ACCOUNT_STAFF principal sees ONLY their own account's rows (a cross-account/cross-org id
 * → 404, never a leak); org-wide staff (OWNER/FINANCE) see the org. Read-only, write-free, audit-free.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: InvoicePdfService,
  ) {}

  async list(principal: RequestPrincipal, query: ListInvoicesQuery): Promise<InvoiceListResult> {
    const db = scopedPrisma(this.prisma, principal); // org (+ account for ACCOUNT_* principals) is AND-merged
    const rows = await db.invoice.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        accountId: true,
        orderId: true,
        number: true,
        status: true,
        total: true,
        currency: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      invoices: page.map((r): InvoiceListItemView => ({
        id: r.id,
        accountId: r.accountId,
        orderId: r.orderId,
        number: r.number,
        status: r.status as InvoiceListItemView['status'],
        total: decimalMoney(r.total),
        currency: r.currency,
        issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      hasMore,
    };
  }

  async get(principal: RequestPrincipal, invoiceId: string): Promise<InvoiceView> {
    const inv = await this.getEntity(principal, invoiceId);
    return this.toView(inv);
  }

  /** Real PDF statement bytes for a scoped invoice (404 if out of scope) + a safe download filename. */
  async statement(principal: RequestPrincipal, invoiceId: string): Promise<{ filename: string; pdf: Buffer }> {
    const inv = await this.getEntity(principal, invoiceId);
    const pdf = await this.pdf.buildStatement(inv);
    const num = (inv.number ?? inv.id.slice(0, 8)).replace(/[^A-Za-z0-9_-]/g, '-');
    return { filename: `invoice-${num}.pdf`, pdf };
  }

  /**
   * The scoped invoice entity (+ lines + account header) for the detail view and the PDF statement.
   * `findFirst` (not `findUnique`) so the non-unique org+account scope AND-merges cleanly → an
   * out-of-scope id naturally yields 404 (no cross-account/cross-org existence leak).
   */
  async getEntity(principal: RequestPrincipal, invoiceId: string) {
    const db = scopedPrisma(this.prisma, principal);
    const inv = await db.invoice.findFirst({
      where: { id: invoiceId },
      include: {
        invoiceLines: { orderBy: { createdAt: 'asc' } },
        account: { select: { name: true, billingMode: true, billingNetDays: true } },
      },
    });
    if (!inv) throw new NotFoundException({ error: INVOICE_PORTAL_ERRORS.INVOICE_NOT_FOUND, message: `invoice ${invoiceId} not found in scope` });
    return inv;
  }

  /** Map the entity to the shared InvoiceView (decimalMoney for amounts; ISO dates; parsed split). */
  toView(inv: InvoiceForStatement): InvoiceView {
    return {
      id: inv.id,
      orderId: inv.orderId,
      number: inv.number,
      status: inv.status as InvoiceView['status'],
      subtotal: decimalMoney(inv.subtotal),
      tax: decimalMoney(inv.tax),
      total: decimalMoney(inv.total),
      currency: inv.currency,
      lines: inv.invoiceLines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: decimalMoney(l.unitAmount),
        amount: decimalMoney(l.amount),
      })),
      costCenterBreakdown: parseStoredBreakdown(inv.costCenterBreakdown),
      issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
      createdAt: inv.createdAt.toISOString(),
    };
  }
}
