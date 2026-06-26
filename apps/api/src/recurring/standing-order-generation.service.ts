import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type StandingOrder } from '@prisma/client';
import {
  OrderStatus,
  OrderType,
  RouteStatus,
  RouteStopKind,
  RouteStopStatus,
  RouteStopHandoff,
  StandingOrderCadence,
  type GenerationResult,
  type PickupWindow,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import { OptimizerService } from '../logistics/optimizer.service';
import { RECURRING_CONFIG, type RecurringConfig } from './recurring.config';
import {
  buildPickupWindowForDate,
  nextOccurrenceAfter,
  occurrenceDatesInWindow,
  periodKey,
  utcDateFloor,
  type CadenceSpec,
} from './recurring-schedule';

const MS_PER_DAY = 86_400_000;

/** A newly-materialized occurrence carried forward to the route auto-gen phase. */
interface GeneratedItem {
  orgId: string;
  occurrenceId: string;
  orderId: string;
  accountId: string;
  siteId: string;
  concierge: boolean;
  date: Date;
  pickupWindow: PickupWindow;
}

/**
 * Standing-order generation job (Track A, PRD §14 recurring route auto-generation). Materializes DUE
 * standing orders into REAL Orders, then auto-generates a recurring Route + RouteStops (reusing the
 * Inc-4 PostGIS sequencer). No fabricated rows — a real schedule produces real orders.
 *
 * REUSES THE INC-8 BACKGROUND PATTERN (the repo has no BullMQ / queue library — see the handoff): an
 * OnModuleInit + setInterval drain (env-gated, 0 ⇒ disabled), plus the explicit `generateDue()` the
 * `POST /v1/standing-orders/run` endpoint and the e2e drive directly.
 *
 * IDEMPOTENT (the Inc-5 pattern): each (standing order, period) is claimed by an INSERT … ON CONFLICT
 * DO NOTHING on StandingOrderOccurrence's unique (standing_order_id, period_key). A re-run / concurrent
 * pass re-evaluates the conflict and materializes nothing new — exactly one Order per period.
 *
 * DEGRADATION (two layers): Orders are committed in their own per-occurrence transaction BEFORE any
 * routing. Route auto-gen runs afterwards, fully wrapped — a route-create or PostGIS-sequencing failure
 * is caught, counted in `routeFailures`, and leaves the generated Orders intact (occurrence.routeId
 * stays NULL). A sequencing failure NEVER loses the generated orders.
 *
 * System job: no request principal — every read/write pins org_id explicitly (the tx-scoping rule),
 * and audit entries are attributed to a null (system) actor.
 */
@Injectable()
export class StandingOrderGenerationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StandingOrderGenerationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** In-process serialization chain: concurrent generateDue() calls run one-after-another. */
  private runChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly optimizer: OptimizerService,
    @Inject(RECURRING_CONFIG) private readonly config: RecurringConfig,
  ) {}

  onModuleInit(): void {
    const ms = this.config.scanIntervalMs;
    if (ms > 0) {
      this.timer = setInterval(() => void this.safeScan(), ms);
      this.timer.unref?.(); // never keep the process alive just for the scan
      this.logger.log(`standing-order generation scan every ${ms}ms (lookback ${this.config.lookbackDays}d)`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Background tick — never throws (a scan error must not crash the process). Non-overlapping. */
  private async safeScan(): Promise<void> {
    if (this.running) return;
    try {
      await this.generateDue();
    } catch (err) {
      this.logger.warn(`scheduled generation scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Run one generation pass. Returns real row counts (honesty firewall — every number is a COUNT of
   * rows actually written). `asOf` makes a run deterministic (tests/back-fill); `standingOrderId` scopes
   * the pass to one standing order; `orgId` confines the pass to ONE tenant (the endpoint passes the
   * caller's org so an ops user can never trigger another tenant's generation — the background system
   * scan omits it to serve all tenants).
   *
   * Concurrent calls are SERIALIZED in-process via a promise chain (so counts stay coherent and work
   * isn't duplicated); the DB occurrence ledger covers cross-process/cluster safety regardless.
   */
  generateDue(opts: { asOf?: Date; standingOrderId?: string; orgId?: string } = {}): Promise<GenerationResult> {
    const next = this.runChain.then(() => this.execPass(opts), () => this.execPass(opts));
    this.runChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async execPass(opts: { asOf?: Date; standingOrderId?: string; orgId?: string }): Promise<GenerationResult> {
    this.running = true;
    try {
      return await this.runPass(opts);
    } finally {
      this.running = false;
    }
  }

  private async runPass(opts: { asOf?: Date; standingOrderId?: string; orgId?: string }): Promise<GenerationResult> {
    const asOf = opts.asOf ?? new Date();
    const lookbackStart = new Date(utcDateFloor(asOf).getTime() - this.config.lookbackDays * MS_PER_DAY);

    const where: Prisma.StandingOrderWhereInput = { active: true, startsOn: { lte: asOf } };
    if (opts.orgId) where.orgId = opts.orgId; // tenant confinement for endpoint-triggered runs
    if (opts.standingOrderId) where.id = opts.standingOrderId;
    const standingOrders = await this.prisma.standingOrder.findMany({ where });

    let occurrencesCreated = 0;
    let ordersCreated = 0;
    // Group newly-generated orders by (org, occurrence date) for one recurring route per building-day.
    const routeGroups = new Map<string, GeneratedItem[]>();

    for (const so of standingOrders) {
      const spec = this.specOf(so);
      const dates = occurrenceDatesInWindow(spec, lookbackStart, asOf);
      const window = so.pickupWindow as PickupWindow;

      for (const date of dates) {
        const key = periodKey(date);
        const made = await this.materializeOccurrence(so, date, key, window);
        if (!made) continue; // already generated this period — idempotent no-op
        occurrencesCreated += 1;
        ordersCreated += 1;
        const gk = `${so.orgId}|${key}`;
        const group = routeGroups.get(gk) ?? [];
        group.push({
          orgId: so.orgId,
          occurrenceId: made.occurrenceId,
          orderId: made.orderId,
          accountId: so.accountId,
          siteId: so.siteId,
          concierge: so.concierge,
          date,
          pickupWindow: window,
        });
        routeGroups.set(gk, group);
      }

      // Advisory next-run/last-run bookkeeping (NOT used for idempotency — the ledger owns that).
      await this.prisma.standingOrder.updateMany({
        where: { id: so.id, orgId: so.orgId },
        data: { nextRunAt: nextOccurrenceAfter(spec, asOf), ...(dates.length ? { lastRunAt: asOf } : {}) },
      });
    }

    // ── Route auto-gen (degradation-wrapped per group) ──
    let routesCreated = 0;
    let routeFailures = 0;
    for (const items of routeGroups.values()) {
      try {
        await this.buildRouteForGroup(items);
        routesCreated += 1;
      } catch (err) {
        routeFailures += items.length; // count the orders left without a route (they still persist)
        this.logger.warn(
          `route auto-gen failed for ${items.length} generated order(s) — orders preserved, route skipped: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      asOf: asOf.toISOString(),
      standingOrdersConsidered: standingOrders.length,
      occurrencesCreated,
      ordersCreated,
      routesCreated,
      routeFailures,
    };
  }

  private specOf(so: StandingOrder): CadenceSpec {
    return {
      cadence: so.cadence as unknown as StandingOrderCadence,
      weekday: so.weekday,
      startsOn: so.startsOn,
      endsOn: so.endsOn,
    };
  }

  /**
   * Atomically CLAIM a (standing order, period) and materialize its Order. Returns null when the period
   * was already claimed (idempotent no-op). org_id is pinned explicitly (system job — no scoped client).
   */
  private async materializeOccurrence(
    so: StandingOrder,
    date: Date,
    key: string,
    window: PickupWindow,
  ): Promise<{ occurrenceId: string; orderId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      // 1) Claim the period: INSERT … ON CONFLICT DO NOTHING RETURNING (Inc-5). Empty ⇒ already done.
      const claimed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO "StandingOrderOccurrence"
          ("id", "org_id", "standing_order_id", "period_key", "generated_at", "created_at", "updated_at", "created_by")
        VALUES
          (${randomUUID()}::uuid, ${so.orgId}::uuid, ${so.id}::uuid, ${key}, now(), now(), now(), ${so.createdBy}::uuid)
        ON CONFLICT ("standing_order_id", "period_key") DO NOTHING
        RETURNING id::text AS "id"
      `);
      if (claimed.length === 0) return null;
      const occurrenceId = claimed[0].id;

      // 2) Create the real Order (REQUESTED route-stop order for the building pickup).
      const order = await tx.order.create({
        data: {
          orgId: so.orgId,
          accountId: so.accountId,
          siteId: so.siteId,
          vertical: so.vertical,
          type: OrderType.ROUTE_STOP_ORDER,
          status: OrderStatus.REQUESTED,
          scheduledPickupWindow: buildPickupWindowForDate(date, window) as unknown as Prisma.InputJsonValue,
          totals: {},
          createdBy: so.createdBy,
        },
        select: { id: true },
      });

      // 3) Link the occurrence to its Order (the ledger row now points at a real order).
      await tx.standingOrderOccurrence.update({ where: { id: occurrenceId }, data: { orderId: order.id } });

      // 4) Audit (system actor) — the generation is attributable.
      await this.audit.record(
        {
          orgId: so.orgId,
          actorId: null,
          entity: 'Order',
          entityId: order.id,
          action: 'ORDER_GENERATED_FROM_STANDING_ORDER',
          after: { standingOrderId: so.id, periodKey: key, occurrenceId },
        },
        tx,
      );
      return { occurrenceId, orderId: order.id };
    });
  }

  /**
   * Create a recurring Route + a RouteStop per generated order (CONCIERGE handoff flag when the standing
   * order is concierge), then sequence with the Inc-4 PostGIS optimizer. The create commits first; the
   * sequencing is a separate, best-effort step — its failure leaves the route + stops + orders intact.
   */
  private async buildRouteForGroup(items: GeneratedItem[]): Promise<string> {
    const { orgId, date } = items[0];

    const routeId = await this.prisma.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: { orgId, date: utcDateFloor(date), status: RouteStatus.PLANNED, createdBy: null },
        select: { id: true },
      });
      let seq = 1;
      for (const it of items) {
        await tx.routeStop.create({
          data: {
            orgId,
            routeId: route.id,
            seq: seq++,
            accountId: it.accountId,
            siteId: it.siteId,
            orderId: it.orderId,
            kind: RouteStopKind.PICKUP,
            stopKind: it.concierge ? RouteStopHandoff.CONCIERGE : RouteStopHandoff.DIRECT,
            timeWindow: buildPickupWindowForDate(it.date, it.pickupWindow) as unknown as Prisma.InputJsonValue,
            status: RouteStopStatus.PENDING,
            createdBy: null,
          },
        });
        await tx.standingOrderOccurrence.update({ where: { id: it.occurrenceId }, data: { routeId: route.id } });
      }
      await this.audit.record(
        {
          orgId,
          actorId: null,
          entity: 'Route',
          entityId: route.id,
          action: 'ROUTE_GENERATED_FROM_STANDING_ORDERS',
          after: { date: periodKey(date), stopCount: items.length, concierge: items.some((i) => i.concierge) },
        },
        tx,
      );
      return route.id;
    });

    // Sequence via the in-house PostGIS optimizer — OUTSIDE the create tx so a sequencing failure can't
    // roll back (or lose) the route, its stops, or the generated orders (graceful degradation).
    try {
      const orderedIds = await this.optimizer.sequence(routeId, orgId);
      await this.prisma.$transaction(async (tx) => {
        if (orderedIds.length > 1) {
          // Two-phase reseq (temp negatives → finals) to dodge the unique (route_id, seq) collision —
          // the same atomic pattern as RouteService.optimize.
          for (let i = 0; i < orderedIds.length; i++) {
            await tx.routeStop.updateMany({ where: { id: orderedIds[i], orgId, routeId }, data: { seq: -(i + 1) } });
          }
          for (let i = 0; i < orderedIds.length; i++) {
            await tx.routeStop.updateMany({ where: { id: orderedIds[i], orgId, routeId }, data: { seq: i + 1 } });
          }
        }
        await tx.route.update({ where: { id: routeId, orgId }, data: { optimized: true } });
        await this.audit.record(
          { orgId, actorId: null, entity: 'Route', entityId: routeId, action: 'ROUTE_OPTIMIZED', after: { engine: this.optimizer.engineName, stopCount: orderedIds.length } },
          tx,
        );
      });
    } catch (err) {
      this.logger.warn(
        `route ${routeId} PostGIS sequencing degraded (route + stops stand unoptimized; orders intact): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return routeId;
  }
}
