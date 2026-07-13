import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Order, RouteStop } from '@prisma/client';
import {
  CustodyStage,
  ItemStatus,
  LOGISTICS_ERRORS,
  OrderStatus,
  POD_ERRORS,
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
import { ITEM_ORDER_BY } from '../orders/item-order';
import { OrderStateMachine } from '../orders/state-machine.service';
import { RealtimePublisher } from '../realtime/realtime-publisher.service';
import { NotificationService } from '../notifications/notification.service';
import { CreditsService } from '../credits/credits.service';
import { LogisticsAccessService } from './logistics-access.service';
import { RouteStopStateMachine } from './route-stop-state-machine.service';
import { DELIVERY_KINDS } from './stop-kinds';

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
    private readonly notifications: NotificationService,
    private readonly credits: CreditsService,
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

    // [Inc-31] POD gate on the SHARED path: a DELIVERY/BOTH stop cannot COMPLETE without a captured
    // ProofOfDelivery — enforced here so DELIVERED is unreachable without proof from ANY caller (the driver
    // duty-loop, which also pre-checks in driver.service, AND the ops/dispatch /v1/route-stops:complete
    // route, which previously reached the completion path ungated). Checked BEFORE the tx so a missing POD
    // never enters the state machine — a clean 4xx, no half-applied transition. Pickup stops are untouched.
    if (to === RouteStopStatus.COMPLETED && DELIVERY_KINDS.has(stop.kind as unknown as RouteStopKind)) {
      const pod = await this.prisma.proofOfDelivery.findFirst({ where: { routeStopId: stop.id, orgId: stop.orgId }, select: { id: true } });
      if (!pod) {
        throw new BadRequestException({ error: POD_ERRORS.POD_REQUIRED, message: 'capture proof of delivery before completing this delivery stop' });
      }
    }

    // The order id that this call actually drove to DELIVERED (if any) — captured inside the tx, used to
    // enqueue the RATE_REQUEST push AFTER commit (like the realtime teardown below), never inside the tx.
    let deliveredOrderId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      await this.stopStateMachine.apply(tx, stop, to, { actorId: principal.userId, reason: opts.reason, note: opts.note });
      if (opts.leg === 'depart') {
        await this.pickupDepartLeg(tx, stop, principal.userId);
        await this.deliveryDepartLeg(tx, stop, principal.userId);
      }
      if (opts.leg === 'complete') {
        await this.pickupCompleteLeg(tx, stop, principal.userId);
        deliveredOrderId = await this.deliveryCompleteLeg(tx, stop, principal.userId);
      }
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

    // [Inc-32] When this completion drove the order to DELIVERED, invite the owning customer to rate it.
    // Enqueued AFTER the tx commits (like the teardown above) so a rolled-back delivery never fires a push;
    // the dispatch is fully isolated (never throws) so a notification hiccup can't fail the stop action.
    if (deliveredOrderId) {
      await this.notifications.dispatchRateRequest(stop.orgId, deliveredOrderId);

      // [Inc-37] THE REFERRAL EARN RULE. If the customer who booked this order was referred by someone, the
      // referrer is credited — but only now, on a real DELIVERED order, and only once per referred friend
      // (DB unique index). Granting at signup instead would be farmable with throwaway accounts, and this is
      // real money. Like the push above: AFTER the tx (a rolled-back delivery pays nobody) and fully isolated
      // (`grantReferralForDeliveredOrder` never throws), so a credit hiccup can never fail a delivery.
      await this.credits.grantReferralForDeliveredOrder(stop.orgId, deliveredOrderId);
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
      // [Inc-29] Ordered — the PICKED_UP custody chain is written in the customer's item sequence.
      const items = await tx.item.findMany({ where: { orderId: order.id, orgId: order.orgId }, orderBy: ITEM_ORDER_BY, select: { id: true } });
      for (const it of items) {
        await tx.custodyEvent.create({ data: { orgId: order.orgId, itemId: it.id, stage: CustodyStage.PICKED_UP, actorId, deviceId: 'route-stop-pickup', createdBy: actorId } });
      }
    }
  }

  // ── order delivery-leg wiring (Inc-31; mirrors the pickup legs one-for-one, conditional + atomic) ──

  /** Driver departs to a delivery → order SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE (if applicable). */
  private async deliveryDepartLeg(tx: Prisma.TransactionClient, stop: RouteStop, actorId: string) {
    if ((stop.kind as unknown as RouteStopKind) === RouteStopKind.PICKUP || !stop.orderId) return;
    const order = await tx.order.findUnique({ where: { id: stop.orderId } });
    if (order && (order.status as unknown as OrderStatus) === OrderStatus.SCHEDULED_DELIVERY) {
      await this.orderStateMachine.apply(tx, order as Order, OrderStatus.DELIVERY_EN_ROUTE, { actorId, reason: 'driver en route to delivery', extraAudit: { stopId: stop.id } });
    }
  }

  /**
   * Delivery completed (POD already enforced in `run()`) → order DELIVERY_EN_ROUTE → DELIVERED, plus a real
   * DELIVERED CustodyEvent per item (append-only, in the customer's item sequence) and Item.status = DELIVERED.
   * Item status is set unconditionally: there is no Item state machine, and items sit at INSPECTED/RECEIVED at
   * delivery time — the delivered order is the authoritative signal that every one of its items is delivered.
   */
  private async deliveryCompleteLeg(tx: Prisma.TransactionClient, stop: RouteStop, actorId: string): Promise<string | null> {
    if ((stop.kind as unknown as RouteStopKind) === RouteStopKind.PICKUP || !stop.orderId) return null;
    const order = await tx.order.findUnique({ where: { id: stop.orderId } });
    if (order && (order.status as unknown as OrderStatus) === OrderStatus.DELIVERY_EN_ROUTE) {
      await this.orderStateMachine.apply(tx, order as Order, OrderStatus.DELIVERED, { actorId, reason: 'delivered at stop', extraAudit: { stopId: stop.id } });
      const items = await tx.item.findMany({ where: { orderId: order.id, orgId: order.orgId }, orderBy: ITEM_ORDER_BY, select: { id: true } });
      for (const it of items) {
        await tx.custodyEvent.create({ data: { orgId: order.orgId, itemId: it.id, stage: CustodyStage.DELIVERED, actorId, deviceId: 'route-stop-delivery', createdBy: actorId } });
        await tx.item.update({ where: { id: it.id }, data: { status: ItemStatus.DELIVERED } });
      }
      return order.id; // signals run() to enqueue the RATE_REQUEST after commit
    }
    return null;
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
