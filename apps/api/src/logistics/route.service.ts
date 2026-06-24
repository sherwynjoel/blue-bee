import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LOGISTICS_ERRORS,
  OrderStatus,
  OrderVertical,
  RouteStatus,
  RouteStopKind,
  RouteStopStatus,
  type AddStopDto,
  type AssignRouteDto,
  type CreateRouteDto,
  type ListRoutesQuery,
  type OptimizeRouteDto,
  type PublishRouteDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';
import { OrderAccessService } from '../orders/order-access.service';
import { OrderStateMachine } from '../orders/state-machine.service';
import { LogisticsAccessService } from './logistics-access.service';
import { OptimizerService } from './optimizer.service';

/** Order states from which a PICKUP stop is meaningful (pickup precedes intake/quote in §5.1). */
const PICKUPABLE: OrderStatus[] = [OrderStatus.REQUESTED, OrderStatus.SCHEDULED_PICKUP];

const ROUTE_INCLUDE = {
  driver: { include: { user: { select: { id: true, name: true } } } },
  vehicle: true,
  stops: { orderBy: { seq: 'asc' as const }, include: { order: { select: { id: true, status: true, accountId: true } } } },
} satisfies Prisma.RouteInclude;

@Injectable()
export class RouteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: LogisticsAccessService,
    private readonly orderAccess: OrderAccessService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly optimizer: OptimizerService,
  ) {}

  // ─────────────────────────────── create / read / list ───────────────────────────────

  async create(principal: RequestPrincipal, dto: CreateRouteDto) {
    if (dto.driverId) await this.access.requireDriver(principal, dto.driverId);
    if (dto.vehicleId) await this.access.requireVehicle(principal, dto.vehicleId);
    const route = await this.prisma.route.create({
      data: { orgId: principal.orgId, date: dto.date, driverId: dto.driverId ?? null, vehicleId: dto.vehicleId ?? null, status: RouteStatus.PLANNED, createdBy: principal.userId },
    });
    if (dto.startGeo) {
      await this.prisma.$executeRaw`
        UPDATE "Route" SET start_geo = ST_SetSRID(ST_MakePoint(${dto.startGeo.lng}, ${dto.startGeo.lat}), 4326)::geography
        WHERE id = ${route.id}::uuid AND org_id = ${principal.orgId}::uuid`;
    }
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Route', entityId: route.id, action: 'ROUTE_CREATED', after: { date: dto.date.toISOString().slice(0, 10), hasDepot: !!dto.startGeo } });
    return this.get(principal, route.id);
  }

  async get(principal: RequestPrincipal, routeId: string) {
    await this.access.requireRoute(principal, routeId);
    const route = await this.access.scopedFor(principal).route.findUnique({ where: { id: routeId }, include: ROUTE_INCLUDE });
    if (!route) throw new NotFoundException({ error: LOGISTICS_ERRORS.ROUTE_NOT_FOUND, message: `Route ${routeId} not found` });
    return route;
  }

  async list(principal: RequestPrincipal, query: ListRoutesQuery) {
    const db = this.access.scopedFor(principal);
    const where: Prisma.RouteWhereInput = query.status ? { status: query.status as unknown as Prisma.RouteWhereInput['status'] } : {};
    const rows = await db.route.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { _count: { select: { stops: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return { routes: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
  }

  // ─────────────────────────────── stops ───────────────────────────────

  async addStop(principal: RequestPrincipal, routeId: string, dto: AddStopDto) {
    const route = await this.access.requireRoute(principal, routeId);
    if ((route.status as unknown as RouteStatus) !== RouteStatus.PLANNED) {
      throw new ConflictException({ error: LOGISTICS_ERRORS.ROUTE_NOT_DRAFT, message: 'Stops can only be added while the route is PLANNED' });
    }
    // Stop↔order parent-ownership (org boundary on the parent order).
    const order = await this.orderAccess.requireOrderForWrite(principal, dto.orderId);
    if ((order.vertical as unknown as OrderVertical) !== OrderVertical.SPECIALTY) {
      throw new BadRequestException({ error: LOGISTICS_ERRORS.STOP_ORDER_INVALID, message: 'Only specialty orders are routable in Phase 1' });
    }
    if ((dto.kind ?? RouteStopKind.PICKUP) === RouteStopKind.PICKUP && !PICKUPABLE.includes(order.status as unknown as OrderStatus)) {
      throw new ConflictException({ error: LOGISTICS_ERRORS.STOP_ORDER_INVALID, message: `Order ${order.id} is ${order.status}; a pickup stop needs REQUESTED/SCHEDULED_PICKUP (pickup precedes quote in §5.1)` });
    }

    // Auto-assigned seq is MAX(seq)+1; on a concurrent-add collision (unique [routeId,seq])
    // recompute and retry. An EXPLICIT seq that collides is a real 409 (no retry).
    const explicitSeq = dto.seq !== undefined;
    for (let attempt = 0; ; attempt++) {
      const seq = dto.seq ?? ((await this.prisma.routeStop.aggregate({ where: { routeId, orgId: principal.orgId }, _max: { seq: true } }))._max.seq ?? 0) + 1;
      try {
        const stop = await this.prisma.routeStop.create({
          data: {
            orgId: principal.orgId,
            routeId,
            seq,
            accountId: order.accountId,
            siteId: order.siteId,
            orderId: order.id,
            kind: dto.kind ?? RouteStopKind.PICKUP,
            timeWindow: (dto.timeWindow ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            status: RouteStopStatus.PENDING,
            createdBy: principal.userId,
          },
        });
        await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'RouteStop', entityId: stop.id, action: 'STOP_ADDED', after: { routeId, orderId: order.id, seq, kind: stop.kind } });
        return stop;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          if (explicitSeq || attempt >= 4) {
            throw new ConflictException({ error: LOGISTICS_ERRORS.SEQ_TAKEN, message: `seq ${seq} is already used on this route` });
          }
          continue; // concurrent auto-seq collision — recompute MAX(seq)+1 and retry
        }
        throw err;
      }
    }
  }

  // ─────────────────────────────── assign / publish / optimize ───────────────────────────────

  async assign(principal: RequestPrincipal, routeId: string, dto: AssignRouteDto) {
    await this.access.requireRoute(principal, routeId);
    if (dto.driverId) await this.access.requireDriver(principal, dto.driverId);
    if (dto.vehicleId) await this.access.requireVehicle(principal, dto.vehicleId);
    await this.prisma.route.update({
      where: { id: routeId, orgId: principal.orgId },
      data: { ...(dto.driverId !== undefined ? { driverId: dto.driverId } : {}), ...(dto.vehicleId !== undefined ? { vehicleId: dto.vehicleId } : {}) },
    });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Route', entityId: routeId, action: 'ROUTE_ASSIGNED', after: { driverId: dto.driverId ?? null, vehicleId: dto.vehicleId ?? null } });
    return this.get(principal, routeId);
  }

  async publish(principal: RequestPrincipal, routeId: string, _dto: PublishRouteDto) {
    const route = await this.access.requireRoute(principal, routeId);
    if ((route.status as unknown as RouteStatus) !== RouteStatus.PLANNED) {
      throw new ConflictException({ error: LOGISTICS_ERRORS.INVALID_ROUTE_STATE, message: `Route is ${route.status}; only a PLANNED route can be published` });
    }
    if (!route.driverId || !route.vehicleId) {
      throw new BadRequestException({ error: LOGISTICS_ERRORS.INVALID_ROUTE_STATE, message: 'Assign a driver and a vehicle before publishing' });
    }
    const stops = await this.prisma.routeStop.findMany({ where: { routeId, orgId: principal.orgId }, include: { order: true } });
    if (stops.length === 0) {
      throw new BadRequestException({ error: LOGISTICS_ERRORS.INVALID_ROUTE_STATE, message: 'A route needs at least one stop to publish' });
    }

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.route.updateMany({ where: { id: routeId, orgId: principal.orgId, status: RouteStatus.PLANNED }, data: { status: RouteStatus.PUBLISHED } });
      if (res.count !== 1) throw new ConflictException({ error: LOGISTICS_ERRORS.INVALID_ROUTE_STATE, message: 'Route was concurrently modified' });

      // Order-leg: publishing schedules each pickup — REQUESTED → SCHEDULED_PICKUP (atomic, audited).
      // Dedupe by order id so an order on multiple pickup stops is advanced EXACTLY ONCE
      // (a second apply on a now-SCHEDULED order would 409 and roll the whole publish back).
      const scheduled = new Set<string>();
      for (const stop of stops) {
        if (!stop.order) continue;
        const isPickup = (stop.kind as unknown as RouteStopKind) !== RouteStopKind.DELIVERY;
        if (isPickup && !scheduled.has(stop.order.id) && (stop.order.status as unknown as OrderStatus) === OrderStatus.REQUESTED) {
          await this.orderStateMachine.apply(tx, stop.order, OrderStatus.SCHEDULED_PICKUP, { actorId: principal.userId, reason: 'scheduled onto a published route', extraAudit: { routeId, stopId: stop.id } });
          scheduled.add(stop.order.id);
        }
      }
      await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Route', entityId: routeId, action: 'ROUTE_PUBLISHED', after: { stopCount: stops.length } }, tx);
    });
    return this.get(principal, routeId);
  }

  async optimize(principal: RequestPrincipal, routeId: string, _dto: OptimizeRouteDto) {
    const route = await this.access.requireRoute(principal, routeId);
    if ((route.status as unknown as RouteStatus) !== RouteStatus.PLANNED) {
      throw new ConflictException({ error: LOGISTICS_ERRORS.INVALID_ROUTE_STATE, message: 'Optimize a route before publishing it (PLANNED only)' });
    }
    const before = (await this.prisma.routeStop.findMany({ where: { routeId, orgId: principal.orgId }, orderBy: { seq: 'asc' }, select: { id: true } })).map((s) => s.id);
    const orderedIds = await this.optimizer.sequence(routeId, principal.orgId);

    await this.prisma.$transaction(async (tx) => {
      // Two-phase reseq to avoid the unique [routeId, seq] collision: temp negatives, then finals.
      // Scoped by routeId+orgId so a stop concurrently moved OFF this route (PATCH) can't be
      // mis-sequenced here (it matches 0 rows) — no cross-route corruption.
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.routeStop.updateMany({ where: { id: orderedIds[i], orgId: principal.orgId, routeId }, data: { seq: -(i + 1) } });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.routeStop.updateMany({ where: { id: orderedIds[i], orgId: principal.orgId, routeId }, data: { seq: i + 1 } });
      }
      await tx.route.update({ where: { id: routeId, orgId: principal.orgId }, data: { optimized: true } });
      await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Route', entityId: routeId, action: 'ROUTE_OPTIMIZED', before: { order: before }, after: { order: orderedIds, engine: this.optimizer.engineName } }, tx);
    });
    return this.get(principal, routeId);
  }
}
