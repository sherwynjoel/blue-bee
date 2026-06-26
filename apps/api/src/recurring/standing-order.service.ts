import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, type StandingOrder } from '@prisma/client';
import {
  RECURRING_ERRORS,
  StandingOrderCadence,
  type CreateStandingOrderDto,
  type GeneratedForAccountView,
  type ListStandingOrdersQuery,
  type PickupWindow,
  type StandingOrderOccurrenceView,
  type StandingOrderView,
  type UpdateStandingOrderDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { nextOccurrenceAfter, periodKey, type CadenceSpec } from './recurring-schedule';

/**
 * Standing-order CRUD (Track A, PRD §9.2). Org-scoped via `scopedPrisma`, every mutation audited in
 * the same transaction (the Inc-16 admin pattern). The generation job (a separate service) materializes
 * these into real Orders + Routes — this service only manages the recurring definitions.
 */
@Injectable()
export class StandingOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(principal: RequestPrincipal, dto: CreateStandingOrderDto): Promise<StandingOrderView> {
    const db = scopedPrisma(this.prisma, principal);

    // Validate the referenced rows exist IN SCOPE (a scoped read proves org ownership → cross-org → 404).
    const account = await db.account.findFirst({ where: { id: dto.accountId }, select: { id: true } });
    if (!account) throw new NotFoundException({ error: RECURRING_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${dto.accountId} not found in scope` });
    const site = await db.site.findFirst({ where: { id: dto.siteId }, select: { id: true, accountId: true } });
    if (!site) throw new NotFoundException({ error: RECURRING_ERRORS.SITE_NOT_FOUND, message: `site ${dto.siteId} not found in scope` });
    if (site.accountId !== dto.accountId) {
      throw new BadRequestException({ error: RECURRING_ERRORS.SITE_ACCOUNT_MISMATCH, message: `site ${dto.siteId} does not belong to account ${dto.accountId}` });
    }
    const service = await db.service.findFirst({ where: { id: dto.serviceId }, select: { id: true } });
    if (!service) throw new NotFoundException({ error: RECURRING_ERRORS.SERVICE_NOT_FOUND, message: `service ${dto.serviceId} not found in scope` });

    const spec: CadenceSpec = { cadence: dto.cadence, weekday: dto.weekday, startsOn: dto.startsOn, endsOn: dto.endsOn };
    const nextRunAt = nextOccurrenceAfter(spec, new Date(dto.startsOn.getTime() - 86_400_000)); // first on/after startsOn

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.standingOrder.create({
        data: {
          orgId: principal.orgId,
          accountId: dto.accountId,
          siteId: dto.siteId,
          serviceId: dto.serviceId,
          vertical: dto.vertical,
          cadence: dto.cadence,
          weekday: dto.weekday,
          pickupWindow: dto.pickupWindow as unknown as Prisma.InputJsonValue,
          concierge: dto.concierge,
          active: dto.active,
          startsOn: dto.startsOn,
          endsOn: dto.endsOn ?? null,
          nextRunAt,
          createdBy: principal.userId,
        },
      });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'StandingOrder',
          entityId: row.id,
          action: 'STANDING_ORDER_CREATED',
          after: { accountId: dto.accountId, siteId: dto.siteId, serviceId: dto.serviceId, cadence: dto.cadence, weekday: dto.weekday, concierge: dto.concierge },
        },
        tx,
      );
      return row;
    });

    return this.toView(created);
  }

  async list(principal: RequestPrincipal, query: ListStandingOrdersQuery): Promise<{ standingOrders: StandingOrderView[]; nextCursor: string | null; hasMore: boolean }> {
    const db = scopedPrisma(this.prisma, principal);
    const where: Prisma.StandingOrderWhereInput = {
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
    };
    const rows = await db.standingOrder.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return { standingOrders: page.map((r) => this.toView(r)), nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
  }

  async get(principal: RequestPrincipal, id: string): Promise<StandingOrderView> {
    return this.toView(await this.require(principal, id));
  }

  async update(principal: RequestPrincipal, id: string, dto: UpdateStandingOrderDto): Promise<StandingOrderView> {
    const existing = await this.require(principal, id);

    // Recompute the advisory nextRunAt when the recurrence shape changes.
    const spec: CadenceSpec = {
      cadence: (dto.cadence ?? (existing.cadence as unknown as StandingOrderCadence)),
      weekday: dto.weekday ?? existing.weekday,
      startsOn: existing.startsOn,
      endsOn: dto.endsOn !== undefined ? dto.endsOn : existing.endsOn,
    };
    const nextRunAt = nextOccurrenceAfter(spec, new Date());

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.standingOrder.update({
        where: { id, orgId: principal.orgId },
        data: {
          ...(dto.cadence !== undefined ? { cadence: dto.cadence } : {}),
          ...(dto.weekday !== undefined ? { weekday: dto.weekday } : {}),
          ...(dto.pickupWindow !== undefined ? { pickupWindow: dto.pickupWindow as unknown as Prisma.InputJsonValue } : {}),
          ...(dto.concierge !== undefined ? { concierge: dto.concierge } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.endsOn !== undefined ? { endsOn: dto.endsOn } : {}),
          nextRunAt,
        },
      });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'StandingOrder',
          entityId: id,
          action: 'STANDING_ORDER_UPDATED',
          before: { cadence: existing.cadence, weekday: existing.weekday, active: existing.active, concierge: existing.concierge },
          after: { ...dto },
        },
        tx,
      );
      return row;
    });

    return this.toView(updated);
  }

  async remove(principal: RequestPrincipal, id: string): Promise<void> {
    await this.require(principal, id); // org-scope guard
    await this.prisma.$transaction(async (tx) => {
      // Cascade removes the occurrence ledger; already-generated Orders are real and persist (scalar link).
      await tx.standingOrder.delete({ where: { id, orgId: principal.orgId } });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'StandingOrder', entityId: id, action: 'STANDING_ORDER_DELETED' },
        tx,
      );
    });
  }

  /** Generated occurrences (orders + routes) for one standing order. */
  async occurrences(principal: RequestPrincipal, id: string): Promise<{ standingOrderId: string; occurrences: StandingOrderOccurrenceView[] }> {
    await this.require(principal, id);
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.standingOrderOccurrence.findMany({ where: { standingOrderId: id }, orderBy: { periodKey: 'asc' } });
    return { standingOrderId: id, occurrences: rows.map((o) => this.occView(o)) };
  }

  /** Generated orders/routes for an account (the lean B2B feed; the web console view is a follow-on). */
  async generatedForAccount(principal: RequestPrincipal, accountId: string): Promise<GeneratedForAccountView> {
    const db = scopedPrisma(this.prisma, principal);
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
    if (!account) throw new NotFoundException({ error: RECURRING_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });
    const rows = await db.standingOrderOccurrence.findMany({
      where: { standingOrder: { accountId } },
      orderBy: { generatedAt: 'desc' },
    });
    const occ = rows.map((o) => this.occView(o));
    return {
      accountId,
      occurrences: occ,
      orderCount: new Set(occ.filter((o) => o.orderId).map((o) => o.orderId)).size,
      routeCount: new Set(occ.filter((o) => o.routeId).map((o) => o.routeId)).size,
    };
  }

  private async require(principal: RequestPrincipal, id: string): Promise<StandingOrder> {
    const db = scopedPrisma(this.prisma, principal);
    const row = await db.standingOrder.findFirst({ where: { id } });
    if (!row) throw new NotFoundException({ error: RECURRING_ERRORS.STANDING_ORDER_NOT_FOUND, message: `standing order ${id} not found in scope` });
    return row;
  }

  private toView(r: StandingOrder): StandingOrderView {
    return {
      id: r.id,
      accountId: r.accountId,
      siteId: r.siteId,
      serviceId: r.serviceId,
      vertical: r.vertical as StandingOrderView['vertical'],
      cadence: r.cadence as unknown as StandingOrderView['cadence'],
      weekday: r.weekday,
      pickupWindow: r.pickupWindow as unknown as PickupWindow,
      concierge: r.concierge,
      active: r.active,
      startsOn: periodKey(r.startsOn),
      endsOn: r.endsOn ? periodKey(r.endsOn) : null,
      nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
      lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private occView(o: { id: string; standingOrderId: string; periodKey: string; orderId: string | null; routeId: string | null; generatedAt: Date }): StandingOrderOccurrenceView {
    return {
      id: o.id,
      standingOrderId: o.standingOrderId,
      periodKey: o.periodKey,
      orderId: o.orderId,
      routeId: o.routeId,
      generatedAt: o.generatedAt.toISOString(),
    };
  }
}
