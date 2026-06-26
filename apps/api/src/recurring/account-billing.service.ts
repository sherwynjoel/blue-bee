import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BillingMode,
  InvoiceStatus,
  RECURRING_ERRORS,
  type BatchInvoiceDto,
  type BillingTermsView,
  type InvoiceView,
  type SetBillingTermsDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { centsToMoney, decimalMoney, moneyToCents } from '../orders/money';
import type { RequestPrincipal } from '../auth/rbac/types';

const CURRENCY = 'CAD';

/** Pull {subtotal?, tax?, total} dollar strings out of an Order.totals JSON. total is required to bill. */
function orderMoney(totals: unknown): { subtotal: string; tax: string; total: string } | null {
  if (!totals || typeof totals !== 'object') return null;
  const t = totals as Record<string, unknown>;
  const num = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
    return null;
  };
  const total = num(t.total);
  if (total === null) return null;
  const subtotal = num(t.subtotal) ?? total;
  const tax = num(t.tax) ?? '0.00';
  return { subtotal, tax, total };
}

/**
 * Per-account billing terms + the batch/periodic invoicing path (Track A, PRD §9.1 / §11 BILLING
 * `POST /invoices:batch`). Sets `Account.billingMode`/`billingNetDays`, and — for a BATCH_PERIODIC
 * account — batches a period's billable Orders into ONE periodic Invoice (net-days due), reusing the
 * Inc-12 Invoice + InvoiceLine models. PER_ORDER stays the Inc-12 specialty path. Cost-center split
 * billing is DEFERRED (Phase 2) — `Invoice.costCenterBreakdown` stays modeled-but-empty, never faked.
 *
 * Idempotent: the batch invoice number is deterministic per (account, period); a re-run returns the
 * existing invoice (re-read on the unique-number race), never a duplicate or a 500.
 */
@Injectable()
export class AccountBillingService {
  private readonly logger = new Logger(AccountBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────── billing terms ───────────────────────────

  async getBillingTerms(principal: RequestPrincipal, accountId: string): Promise<BillingTermsView> {
    const db = scopedPrisma(this.prisma, principal);
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true, billingMode: true, billingNetDays: true } });
    if (!account) throw new NotFoundException({ error: RECURRING_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });
    return { accountId: account.id, billingMode: account.billingMode as unknown as BillingMode, billingNetDays: account.billingNetDays };
  }

  async setBillingTerms(principal: RequestPrincipal, accountId: string, dto: SetBillingTermsDto): Promise<BillingTermsView> {
    const db = scopedPrisma(this.prisma, principal);
    const before = await db.account.findFirst({ where: { id: accountId }, select: { id: true, billingMode: true, billingNetDays: true } });
    if (!before) throw new NotFoundException({ error: RECURRING_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });

    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: accountId, orgId: principal.orgId }, data: { billingMode: dto.billingMode, billingNetDays: dto.netDays } });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Account',
          entityId: accountId,
          action: 'BILLING_TERMS_SET',
          before: { billingMode: before.billingMode, billingNetDays: before.billingNetDays },
          after: { billingMode: dto.billingMode, billingNetDays: dto.netDays },
        },
        tx,
      );
    });

    return { accountId, billingMode: dto.billingMode, billingNetDays: dto.netDays };
  }

  // ─────────────────────────── batch / periodic invoicing ───────────────────────────

  async generateBatchInvoice(principal: RequestPrincipal, accountId: string, dto: BatchInvoiceDto): Promise<InvoiceView> {
    const db = scopedPrisma(this.prisma, principal);
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true, billingMode: true, billingNetDays: true } });
    if (!account) throw new NotFoundException({ error: RECURRING_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });
    if ((account.billingMode as unknown as BillingMode) !== BillingMode.BATCH_PERIODIC) {
      throw new BadRequestException({ error: RECURRING_ERRORS.NOT_BATCH_ACCOUNT, message: `account ${accountId} billingMode is ${account.billingMode}; set BATCH_PERIODIC to batch-invoice` });
    }

    const from = new Date(dto.from);
    const to = new Date(dto.to);
    const period = dto.period ?? `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
    const number = `INV-${accountId.slice(0, 8).toUpperCase()}-${period}`;

    // Idempotency: an existing batch invoice for this (account, period) wins — return it unchanged.
    const prior = await this.prisma.invoice.findFirst({ where: { accountId, orgId: principal.orgId, number } });
    if (prior) return this.toView(prior.id);

    // Billable orders: this account's orders created in [from, to) carrying a total and NOT already
    // invoiced (no Invoice rows back-reference their id). Org-scoped read.
    const candidates = await db.order.findMany({
      where: { accountId, createdAt: { gte: from, lt: to } },
      select: { id: true, totals: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const billableIds = candidates.map((o) => o.id);
    const alreadyInvoiced = new Set(
      (await this.prisma.invoice.findMany({ where: { orgId: principal.orgId, orderId: { in: billableIds } }, select: { orderId: true } }))
        .map((i) => i.orderId)
        .filter((x): x is string => x !== null),
    );

    const lines: { orderId: string; description: string; subtotalCents: number; taxCents: number; totalCents: number }[] = [];
    for (const o of candidates) {
      if (alreadyInvoiced.has(o.id)) continue;
      const m = orderMoney(o.totals);
      if (!m) continue;
      lines.push({
        orderId: o.id,
        description: `Order ${o.id.slice(0, 8).toUpperCase()} — ${o.createdAt.toISOString().slice(0, 10)}`,
        subtotalCents: moneyToCents(m.subtotal),
        taxCents: moneyToCents(m.tax),
        totalCents: moneyToCents(m.total),
      });
    }
    if (lines.length === 0) {
      throw new BadRequestException({ error: RECURRING_ERRORS.NO_BILLABLE_ORDERS, message: `no un-invoiced billable orders for account ${accountId} in [${from.toISOString()}, ${to.toISOString()})` });
    }

    const subtotalCents = lines.reduce((a, l) => a + l.subtotalCents, 0);
    const taxCents = lines.reduce((a, l) => a + l.taxCents, 0);
    const totalCents = lines.reduce((a, l) => a + l.totalCents, 0);
    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + account.billingNetDays * 86_400_000);

    let invoiceId: string;
    try {
      invoiceId = await this.prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            orgId: principal.orgId,
            accountId,
            orderId: null, // batch invoice spans many orders (the lines carry the per-order breakdown)
            period,
            number,
            subtotal: centsToMoney(subtotalCents),
            tax: centsToMoney(taxCents),
            total: centsToMoney(totalCents),
            currency: CURRENCY,
            status: InvoiceStatus.ISSUED,
            issuedAt,
            dueAt,
            lines: lines.map((l) => ({ orderId: l.orderId, description: l.description, amount: centsToMoney(l.totalCents) })) as unknown as Prisma.InputJsonValue,
            createdBy: principal.userId,
          },
          select: { id: true },
        });
        await tx.invoiceLine.createMany({
          data: lines.map((l) => ({ orgId: principal.orgId, invoiceId: inv.id, description: l.description, quantity: 1, unitAmount: centsToMoney(l.totalCents), amount: centsToMoney(l.totalCents) })),
        });
        await this.audit.record(
          {
            orgId: principal.orgId,
            actorId: principal.userId,
            entity: 'Invoice',
            entityId: inv.id,
            action: 'BATCH_INVOICE_GENERATED',
            after: { accountId, period, orderCount: lines.length, total: centsToMoney(totalCents), netDays: account.billingNetDays },
          },
          tx,
        );
        return inv.id;
      });
    } catch (err) {
      // Race: a concurrent batch won the unique number → re-read + return it (idempotent, never a 500).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.invoice.findFirst({ where: { accountId, orgId: principal.orgId, number } });
        if (raced) return this.toView(raced.id);
      }
      throw err;
    }

    return this.toView(invoiceId);
  }

  private async toView(invoiceId: string): Promise<InvoiceView> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { invoiceLines: true } });
    if (!inv) throw new ConflictException(`invoice ${invoiceId} vanished`);
    return {
      id: inv.id,
      orderId: inv.orderId,
      number: inv.number,
      status: inv.status as InvoiceView['status'],
      subtotal: decimalMoney(inv.subtotal),
      tax: decimalMoney(inv.tax),
      total: decimalMoney(inv.total),
      currency: inv.currency,
      lines: inv.invoiceLines.map((l) => ({ description: l.description, quantity: l.quantity, unitAmount: decimalMoney(l.unitAmount), amount: decimalMoney(l.amount) })),
      issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
      createdAt: inv.createdAt.toISOString(),
    };
  }
}
