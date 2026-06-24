import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Order, RouteStop } from '@prisma/client';
import {
  CustodyStage,
  LOGISTICS_ERRORS,
  OrderStatus,
  RouteStatus,
  RouteStopKind,
  RouteStopStatus,
  type ChannelClosedReason,
  type ListStopsQuery,
  type PatchStopDto,
  type StopActionDto,
  type StopExceptionDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';
import { OrderStateMachine } from '../orders/state-machine.service';
import { RealtimePublisher } from '../realtime/realtime-publisher.service';
import { LogisticsAccessService } from './logistics-access.service';
import { RouteStopStateMachine } from './route-stop-state-machine.service';

/** Route states in which stops may be worked. */
const WORKABLE_ROUTE = new Set<RouteStatus>([RouteStatus.PUBLISHED, RouteStatus.IN_PROGRESS]);
const TERMINAL_STOP = new Set<RouteStopStatus>([RouteStopStatus.COMPLETED, RouteStopStatus.FAILED, RouteStopStatus.SKIPPED]);

@Injectable()
export class RouteStopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: LogisticsAccessService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly stopStateMachine: RouteStopStateMachine,
    private readonly realtime: RealtimePublisher,
  ) {}

  // ─────────────────────────────── reads ───────────────────────────────

  getStop(principal: RequestPrincipal, stopId: string) {
    return this.access.scopedFor(principal).routeStop
      .findUnique({ where: { id: stopId }, include: { order: { select: { id: true, status: true } }, route: { select: { id: true, status: true, driverId: true } } } })
      .then((s) => {
        if (!s) throw new NotFoundException({ error: LOGISTICS_ERRORS.STOP_NOT_FOUND, message: `Stop ${stopId} not found` });
        return s;
      });
  }

  async list(principal: RequestPrincipal, query: ListStopsQuery) {
    const db = this.access.scopedFor(principal);
    const where: Prisma.RouteStopWhereInput = {
      ...(query.status ? { status: query.status as unknown as Prisma.RouteStopWhereInput['status'] } : {}),
      ...(query.routeId ? { routeId: query.routeId } : {}),
    };
    const rows = await db.routeStop.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { order: { select: { id: true, status: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return { stops: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
  }

  // ─────────────────────────────── §5.4 transitions (driver-stop verbs) ───────────────────────────────

  depart(p: RequestPrincipal, id: string, dto: StopActionDto) { return this.run(p, id, RouteStopStatus.EN_ROUTE, { note: dto.note, leg: 'depart' }); }
  arrive(p: RequestPrincipal, id: string, dto: StopActionDto) { return this.run(p, id, RouteStopStatus.ARRIVED, { note: dto.note }); }
  start(p: RequestPrincipal, id: string, dto: StopActionDto) { return this.run(p, id, RouteStopStatus.IN_PROGRESS, { note: dto.note }); }
  complete(p: RequestPrincipal, id: string, dto: StopActionDto) { return this.run(p, id, RouteStopStatus.COMPLETED, { note: dto.note, leg: 'complete' }); }
  fail(p: RequestPrincipal, id: string, dto: StopExceptionDto) { return this.run(p, id, RouteStopStatus.FAILED, { reason: dto.reason, note: dto.note }); }
  skip(p: RequestPrincipal, id: string, dto: StopExceptionDto) { return this.run(p, id, RouteStopStatus.SKIPPED, { reason: dto.reason, note: dto.note }); }

  private async run(
    principal: RequestPrincipal,
    stopId: string,
    to: RouteStopStatus,
    opts: { reason?: string; note?: string; leg?: 'depart' | 'complete' },
  ) {
    const stop = await this.access.requireStop(principal, stopId);
    if (!WORKABLE_ROUTE.has(stop.route.status as unknown as RouteStatus)) {
      throw new ConflictException({ error: LOGISTICS_ERRORS.INVALID_ROUTE_STATE, message: `Route is ${stop.route.status}; publish it before working its stops` });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.stopStateMachine.apply(tx, stop, to, { actorId: principal.userId, reason: opts.reason, note: opts.note });
      if (opts.leg === 'depart') await this.pickupDepartLeg(tx, stop, principal.userId);
      if (opts.leg === 'complete') await this.pickupCompleteLeg(tx, stop, principal.userId);
      if (to === RouteStopStatus.IN_PROGRESS) await this.maybeStartRoute(tx, stop.routeId, stop.orgId, principal.userId);
      if (TERMINAL_STOP.has(to)) await this.maybeCompleteRoute(tx, stop.routeId, stop.orgId, principal.userId);
    });

    // Realtime teardown (Increment 6): once the stop is terminal, the customer must not keep
    // tracking (no tracking after delivery, §6.2). Done AFTER the tx commits so a rolled-back
    // transition never tears a live channel down. The signed token is also self-invalidating —
    // a reconnect re-checks live stop state — so this closes existing sockets, that blocks new ones.
    if (TERMINAL_STOP.has(to)) {
      const reason: ChannelClosedReason =
        to === RouteStopStatus.COMPLETED ? 'stop_completed' : to === RouteStopStatus.FAILED ? 'stop_failed' : 'stop_skipped';
      await this.realtime.closeStopChannel(stop.orgId, stop.id, stop.route.vehicleId ?? '', reason);
    }
    return this.getStop(principal, stopId);
  }

  // ── order pickup-leg wiring (the real handoff; conditional + atomic in the same tx) ──

  /** Driver departs to a pickup → order SCHEDULED_PICKUP → PICKUP_EN_ROUTE (if applicable). */
  private async pickupDepartLeg(tx: Prisma.TransactionClient, stop: RouteStop, actorId: string) {
    if ((stop.kind as unknown as RouteStopKind) === RouteStopKind.DELIVERY || !stop.orderId) return;
    const order = await tx.order.findUnique({ where: { id: stop.orderId } });
    if (order && (order.status as unknown as OrderStatus) === OrderStatus.SCHEDULED_PICKUP) {
      await this.orderStateMachine.apply(tx, order as Order, OrderStatus.PICKUP_EN_ROUTE, { actorId, reason: 'driver en route to pickup', extraAudit: { stopId: stop.id } });
    }
  }

  /** Pickup completed → order PICKUP_EN_ROUTE → PICKED_UP + a real PICKED_UP CustodyEvent per item. */
  private async pickupCompleteLeg(tx: Prisma.TransactionClient, stop: RouteStop, actorId: string) {
    if ((stop.kind as unknown as RouteStopKind) === RouteStopKind.DELIVERY || !stop.orderId) return;
    const order = await tx.order.findUnique({ where: { id: stop.orderId } });
    if (order && (order.status as unknown as OrderStatus) === OrderStatus.PICKUP_EN_ROUTE) {
      await this.orderStateMachine.apply(tx, order as Order, OrderStatus.PICKED_UP, { actorId, reason: 'picked up at stop', extraAudit: { stopId: stop.id } });
      const items = await tx.item.findMany({ where: { orderId: order.id, orgId: order.orgId }, select: { id: true } });
      for (const it of items) {
        await tx.custodyEvent.create({ data: { orgId: order.orgId, itemId: it.id, stage: CustodyStage.PICKED_UP, actorId, deviceId: 'route-stop-pickup', createdBy: actorId } });
      }
    }
  }

  private async maybeStartRoute(tx: Prisma.TransactionClient, routeId: string, orgId: string, actorId: string) {
    const res = await tx.route.updateMany({ where: { id: routeId, orgId, status: RouteStatus.PUBLISHED }, data: { status: RouteStatus.IN_PROGRESS } });
    if (res.count === 1) {
      await this.audit.record({ orgId, actorId, entity: 'Route', entityId: routeId, action: 'ROUTE_STARTED', after: { status: RouteStatus.IN_PROGRESS } }, tx);
    }
  }

  private async maybeCompleteRoute(tx: Prisma.TransactionClient, routeId: string, orgId: string, actorId: string) {
    const remaining = await tx.routeStop.count({ where: { routeId, orgId, status: { notIn: [RouteStopStatus.COMPLETED, RouteStopStatus.FAILED, RouteStopStatus.SKIPPED] } } });
    if (remaining === 0) {
      const res = await tx.route.updateMany({ where: { id: routeId, orgId, status: { in: [RouteStatus.PUBLISHED, RouteStatus.IN_PROGRESS] } }, data: { status: RouteStatus.COMPLETED } });
      if (res.count === 1) {
        await this.audit.record({ orgId, actorId, entity: 'Route', entityId: routeId, action: 'ROUTE_COMPLETED', after: { status: RouteStatus.COMPLETED } }, tx);
      }
    }
  }

  // ─────────────────────────────── PATCH: reassign (move route) + resequence ───────────────────────────────

  async patch(principal: RequestPrincipal, stopId: string, dto: PatchStopDto) {
    const stop = await this.access.requireStop(principal, stopId);
    let reassignedFromVehicle: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      let routeId = stop.routeId;

      if (dto.routeId && dto.routeId !== stop.routeId) {
        const target = await this.access.requireRoute(principal, dto.routeId);
        const maxSeq = (await tx.routeStop.aggregate({ where: { routeId: target.id, orgId: principal.orgId }, _max: { seq: true } }))._max.seq ?? 0;
        await tx.routeStop.update({ where: { id: stopId, orgId: principal.orgId }, data: { routeId: target.id, seq: maxSeq + 1 } });
        routeId = target.id;
        // If the stop moves to a route with a DIFFERENT vehicle, the customer's channel token
        // (bound to the old vehicle) is now stale — tear it down so they re-mint a token for
        // the new vehicle (Increment 6 privacy: the customer must only ever see the vehicle
        // assigned to their order's active stop). Captured here, closed after the tx commits.
        if ((target.vehicleId ?? null) !== (stop.route.vehicleId ?? null)) {
          reassignedFromVehicle = stop.route.vehicleId ?? '';
        }
        await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'RouteStop', entityId: stopId, action: 'STOP_REASSIGNED', before: { routeId: stop.routeId }, after: { routeId: target.id, driverId: target.driverId } }, tx);
      }

      if (dto.seq !== undefined) {
        const ordered = (await tx.routeStop.findMany({ where: { routeId, orgId: principal.orgId }, orderBy: { seq: 'asc' }, select: { id: true } })).map((s) => s.id);
        const without = ordered.filter((id) => id !== stopId);
        const pos = Math.min(Math.max(dto.seq, 1), without.length + 1) - 1;
        const desired = [...without.slice(0, pos), stopId, ...without.slice(pos)];
        // Scoped by routeId so a reseq can only touch stops on the intended route.
        for (let i = 0; i < desired.length; i++) await tx.routeStop.updateMany({ where: { id: desired[i], orgId: principal.orgId, routeId }, data: { seq: -(i + 1) } });
        for (let i = 0; i < desired.length; i++) await tx.routeStop.updateMany({ where: { id: desired[i], orgId: principal.orgId, routeId }, data: { seq: i + 1 } });
        await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'RouteStop', entityId: stopId, action: 'STOP_RESEQUENCED', after: { routeId, order: desired } }, tx);
      }

      if (dto.timeWindow) {
        await tx.routeStop.update({ where: { id: stopId, orgId: principal.orgId }, data: { timeWindow: dto.timeWindow as unknown as Prisma.InputJsonValue } });
      }
    });

    // After the tx commits (never on a rolled-back reassign): if the vehicle changed, close
    // the now-stale customer channel for the old vehicle's stop room.
    if (reassignedFromVehicle !== null) {
      await this.realtime.closeStopChannel(stop.orgId, stop.id, reassignedFromVehicle, 'stop_reassigned');
    }
    return this.getStop(principal, stopId);
  }
}
