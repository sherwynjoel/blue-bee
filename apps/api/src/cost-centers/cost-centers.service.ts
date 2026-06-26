import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CostCenter } from '@prisma/client';
import {
  COST_CENTER_ERRORS,
  type AttachOrderCostCenterDto,
  type CostCenterKind,
  type CostCenterListResult,
  type CostCenterReportQuery,
  type CostCenterReportRow,
  type CostCenterReportView,
  type CostCenterView,
  type CreateCostCenterDto,
  type ListCostCentersQuery,
  type OrderCostCenterView,
  type UpdateCostCenterDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { centsToMoney, moneyToCents, parseOrderTotals } from '../orders/money';
import { UNASSIGNED } from './cost-center-split';
import type { RequestPrincipal } from '../auth/rbac/types';

const CURRENCY = 'CAD';

/**
 * Cost-centre CRUD + order attribution + the per-cost-centre period report/CSV (Track A Phase 2 — PRD
 * §B4.1/§A5.2/§B5.2). Org-scoped via `scopedPrisma`, every mutation audited in the same transaction
 * (the Track-A pattern), problem+json errors. A cost centre lives UNDER one Account (optionally scoped to
 * a Site); attribution is orthogonal metadata that never touches the §5.1 order spine. The split-billing
 * engine that consumes attribution lives in `recurring/account-billing.service`.
 */
@Injectable()
export class CostCentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────── CRUD ───────────────────────────

  async create(principal: RequestPrincipal, accountId: string, dto: CreateCostCenterDto): Promise<CostCenterView> {
    const db = scopedPrisma(this.prisma, principal);
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
    if (!account) throw new NotFoundException({ error: COST_CENTER_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });

    if (dto.siteId) {
      const site = await db.site.findFirst({ where: { id: dto.siteId }, select: { id: true, accountId: true } });
      if (!site) throw new NotFoundException({ error: COST_CENTER_ERRORS.SITE_NOT_FOUND, message: `site ${dto.siteId} not found in scope` });
      if (site.accountId !== accountId) {
        throw new BadRequestException({ error: COST_CENTER_ERRORS.SITE_ACCOUNT_MISMATCH, message: `site ${dto.siteId} does not belong to account ${accountId}` });
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // tx client is unscoped — org_id is pinned explicitly (the Inc-4 tx-scoping lesson).
        const row = await tx.costCenter.create({
          data: {
            orgId: principal.orgId,
            accountId,
            siteId: dto.siteId ?? null,
            code: dto.code,
            name: dto.name,
            kind: dto.kind ?? null,
            active: true,
            createdBy: principal.userId,
          },
        });
        await this.audit.record(
          {
            orgId: principal.orgId,
            actorId: principal.userId,
            entity: 'CostCenter',
            entityId: row.id,
            action: 'COST_CENTER_CREATED',
            after: { accountId, siteId: dto.siteId ?? null, code: dto.code, name: dto.name, kind: dto.kind ?? null },
          },
          tx,
        );
        return row;
      });
      return this.toView(created);
    } catch (err) {
      // Unique (account_id, code) → a re-used code is a 409, never a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ error: COST_CENTER_ERRORS.DUPLICATE_CODE, message: `cost-centre code "${dto.code}" already exists for account ${accountId}` });
      }
      throw err;
    }
  }

  async list(principal: RequestPrincipal, accountId: string, query: ListCostCentersQuery): Promise<CostCenterListResult> {
    const db = scopedPrisma(this.prisma, principal);
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
    if (!account) throw new NotFoundException({ error: COST_CENTER_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });

    const rows = await db.costCenter.findMany({
      where: { accountId, ...(query.active !== undefined ? { active: query.active } : {}) },
      orderBy: [{ code: 'asc' }],
    });
    return { costCenters: rows.map((r) => this.toView(r)) };
  }

  async update(principal: RequestPrincipal, id: string, dto: UpdateCostCenterDto): Promise<CostCenterView> {
    const existing = await this.require(principal, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.costCenter.update({
        where: { id, orgId: principal.orgId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'CostCenter',
          entityId: id,
          action: 'COST_CENTER_UPDATED',
          before: { name: existing.name, kind: existing.kind, active: existing.active },
          after: { ...dto },
        },
        tx,
      );
      return row;
    });
    return this.toView(updated);
  }

  // ─────────────────────────── order attribution ───────────────────────────

  async attachOrder(principal: RequestPrincipal, orderId: string, dto: AttachOrderCostCenterDto): Promise<OrderCostCenterView> {
    const db = scopedPrisma(this.prisma, principal);
    const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true, accountId: true, costCenterId: true } });
    if (!order) throw new NotFoundException({ error: COST_CENTER_ERRORS.ORDER_NOT_FOUND, message: `order ${orderId} not found in scope` });

    if (dto.costCenterId !== null) {
      const cc = await db.costCenter.findUnique({ where: { id: dto.costCenterId }, select: { id: true, accountId: true } });
      if (!cc) throw new NotFoundException({ error: COST_CENTER_ERRORS.COST_CENTER_NOT_FOUND, message: `cost centre ${dto.costCenterId} not found in scope` });
      if (cc.accountId !== order.accountId) {
        throw new BadRequestException({ error: COST_CENTER_ERRORS.ACCOUNT_MISMATCH, message: `cost centre ${dto.costCenterId} belongs to a different account than order ${orderId}` });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId, orgId: principal.orgId }, data: { costCenterId: dto.costCenterId } });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Order',
          entityId: orderId,
          action: 'ORDER_COST_CENTER_SET',
          before: { costCenterId: order.costCenterId },
          after: { costCenterId: dto.costCenterId },
        },
        tx,
      );
    });
    return { orderId, accountId: order.accountId, costCenterId: dto.costCenterId };
  }

  // ─────────────────────────── period report + CSV ───────────────────────────

  async report(principal: RequestPrincipal, accountId: string, query: CostCenterReportQuery): Promise<CostCenterReportView> {
    const db = scopedPrisma(this.prisma, principal);
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
    if (!account) throw new NotFoundException({ error: COST_CENTER_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });

    const from = new Date(query.from);
    const to = new Date(query.to);
    // Account's orders created in [from, to) (the batch-invoice window semantics), scoped read.
    const orders = await db.order.findMany({
      where: { accountId, createdAt: { gte: from, lt: to } },
      select: { totals: true, costCenterId: true },
    });

    // Sum billable order money (integer cents) per cost centre; null ⇒ the explicit Unassigned bucket.
    const buckets = new Map<string, { id: string | null; orderCount: number; subtotal: number; tax: number; total: number }>();
    const UNASSIGNED_KEY = ' unassigned';
    for (const o of orders) {
      const m = parseOrderTotals(o.totals);
      if (!m) continue; // not billable (no total) — never invented into a bucket
      const key = o.costCenterId ?? UNASSIGNED_KEY;
      const b = buckets.get(key) ?? { id: o.costCenterId, orderCount: 0, subtotal: 0, tax: 0, total: 0 };
      b.orderCount += 1;
      b.subtotal += moneyToCents(m.subtotal);
      b.tax += moneyToCents(m.tax);
      b.total += moneyToCents(m.total);
      buckets.set(key, b);
    }

    // Resolve code/name/kind for the referenced centres (scoped to this account).
    const ccIds = [...buckets.values()].map((b) => b.id).filter((x): x is string => x !== null);
    const meta = new Map<string, { code: string; name: string; kind: CostCenterKind | null }>();
    if (ccIds.length > 0) {
      const ccs = await db.costCenter.findMany({ where: { accountId, id: { in: ccIds } }, select: { id: true, code: true, name: true, kind: true } });
      for (const c of ccs) meta.set(c.id, { code: c.code, name: c.name, kind: c.kind as CostCenterKind | null });
    }

    const rows: CostCenterReportRow[] = [...buckets.values()].map((b) => {
      const cm = b.id ? meta.get(b.id) : null;
      return {
        costCenterId: b.id,
        code: b.id ? cm?.code ?? b.id.slice(0, 8).toUpperCase() : UNASSIGNED.code,
        name: b.id ? cm?.name ?? '' : UNASSIGNED.name,
        kind: b.id ? cm?.kind ?? null : null,
        orderCount: b.orderCount,
        subtotal: centsToMoney(b.subtotal),
        tax: centsToMoney(b.tax),
        total: centsToMoney(b.total),
      };
    });
    rows.sort((a, b) => {
      if (a.costCenterId === null) return 1;
      if (b.costCenterId === null) return -1;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });

    const grand = [...buckets.values()].reduce((acc, b) => ({ subtotal: acc.subtotal + b.subtotal, tax: acc.tax + b.tax, total: acc.total + b.total }), { subtotal: 0, tax: 0, total: 0 });

    return {
      accountId,
      from: from.toISOString(),
      to: to.toISOString(),
      currency: CURRENCY,
      rows,
      grandTotal: { subtotal: centsToMoney(grand.subtotal), tax: centsToMoney(grand.tax), total: centsToMoney(grand.total) },
    };
  }

  /** The §B5.2 cost-centre export — the same per-cost-centre totals as `report`, rendered as real CSV bytes. */
  async reportCsv(principal: RequestPrincipal, accountId: string, query: CostCenterReportQuery): Promise<{ filename: string; csv: string }> {
    const view = await this.report(principal, accountId, query);
    const header = ['cost_center_id', 'code', 'name', 'kind', 'order_count', 'subtotal', 'tax', 'total', 'currency'];
    const lines: string[] = [header.map(csvCell).join(',')];
    for (const r of view.rows) {
      lines.push([r.costCenterId ?? '', r.code, r.name, r.kind ?? '', String(r.orderCount), r.subtotal, r.tax, r.total, view.currency].map(csvCell).join(','));
    }
    const totalOrders = view.rows.reduce((a, r) => a + r.orderCount, 0);
    lines.push(['', 'TOTAL', 'All cost centres', '', String(totalOrders), view.grandTotal.subtotal, view.grandTotal.tax, view.grandTotal.total, view.currency].map(csvCell).join(','));
    const csv = `${lines.join('\r\n')}\r\n`;
    const filename = `cost-centers-${accountId}-${view.from.slice(0, 10)}_${view.to.slice(0, 10)}.csv`;
    return { filename, csv };
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async require(principal: RequestPrincipal, id: string): Promise<CostCenter> {
    const db = scopedPrisma(this.prisma, principal);
    const row = await db.costCenter.findFirst({ where: { id } });
    if (!row) throw new NotFoundException({ error: COST_CENTER_ERRORS.COST_CENTER_NOT_FOUND, message: `cost centre ${id} not found in scope` });
    return row;
  }

  private toView(r: CostCenter): CostCenterView {
    return {
      id: r.id,
      accountId: r.accountId,
      siteId: r.siteId,
      code: r.code,
      name: r.name,
      kind: r.kind as CostCenterKind | null,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

/** RFC-4180 CSV cell: quote when the value carries a comma, quote, CR or LF; double embedded quotes. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
