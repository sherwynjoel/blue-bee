import { Injectable } from '@nestjs/common';
import { RouteStatus as DbRouteStatus, RouteStopStatus as DbRouteStopStatus } from '@prisma/client';
import { type FleetLiveResult, type OrderTrackingResult, type StopEta } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { OrderAccessService } from '../orders/order-access.service';
import { ChannelTokenService } from '../realtime/channel-token.service';
import { GpsHistoryService } from './gps-history.service';
import { LastKnownStore } from './last-known.store';
import { selectActiveStop, STOP_PRIORITY } from './tracking-util';

@Injectable()
export class TrackingReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lastKnown: LastKnownStore,
    private readonly history: GpsHistoryService,
    private readonly orderAccess: OrderAccessService,
    private readonly channelTokens: ChannelTokenService,
  ) {}

  /**
   * GET /v1/fleet/live (OWNER/DISPATCH/CSR) — every caller-org vehicle's last-known. Redis is
   * the hot source; vehicles missing from Redis fall back to the latest hypertable row
   * (§6.2). Naturally org-scoped: the vehicle list comes from the scoped Prisma client, so a
   * different-org caller sees only THEIR org's vehicles (never this org's).
   */
  async fleetLive(principal: RequestPrincipal): Promise<FleetLiveResult> {
    const vehicles = await scopedPrisma(this.prisma, principal).vehicle.findMany({
      select: { id: true, label: true },
      orderBy: { label: 'asc' },
    });
    const ids = vehicles.map((v) => v.id);
    const labelOf = new Map(vehicles.map((v) => [v.id, v.label]));

    const fromRedis = await this.lastKnown.readMany(principal.orgId, ids);
    const missing = ids.filter((id) => !fromRedis.has(id));
    const fromHistory = await this.history.latestForVehicles(principal.orgId, missing);
    const etaByVehicle = await this.nextStopEtas(principal, ids);

    const positioned: FleetLiveResult['vehicles'] = [];
    const withoutPosition: FleetLiveResult['withoutPosition'] = [];
    for (const id of ids) {
      const pos = fromRedis.get(id) ?? fromHistory.get(id);
      if (pos) positioned.push({ ...pos, label: labelOf.get(id) ?? '', nextStopEta: etaByVehicle.get(id) ?? null });
      else withoutPosition.push({ vehicleId: id, label: labelOf.get(id) ?? '' });
    }
    return { vehicles: positioned, withoutPosition };
  }

  /**
   * Each vehicle's current active-stop ETA (Increment 7) — the persisted snapshot on the
   * most-progressed EN_ROUTE/ARRIVED stop of a workable route the vehicle is on. Org-scoped via the
   * scoped client (RouteStop carries org_id), so a cross-org caller never sees another org's ETAs.
   */
  private async nextStopEtas(principal: RequestPrincipal, vehicleIds: string[]): Promise<Map<string, StopEta>> {
    const out = new Map<string, StopEta>();
    if (vehicleIds.length === 0) return out;
    const stops = await scopedPrisma(this.prisma, principal).routeStop.findMany({
      where: {
        status: { in: [DbRouteStopStatus.EN_ROUTE, DbRouteStopStatus.ARRIVED] },
        eta: { not: null },
        route: {
          status: { in: [DbRouteStatus.PUBLISHED, DbRouteStatus.IN_PROGRESS] },
          vehicleId: { in: vehicleIds },
        },
      },
      select: { id: true, seq: true, status: true, eta: true, etaLow: true, etaHigh: true, etaComputedAt: true, route: { select: { vehicleId: true } } },
    });

    // Most-progressed per vehicle: ARRIVED before EN_ROUTE (STOP_PRIORITY), tie-broken by seq.
    const best = new Map<string, (typeof stops)[number]>();
    for (const s of stops) {
      const vid = s.route.vehicleId;
      if (!vid || !s.eta) continue;
      const cur = best.get(vid);
      if (!cur || this.moreActive(s, cur)) best.set(vid, s);
    }
    for (const [vid, s] of best) out.set(vid, this.toStopEta(s));
    return out;
  }

  private moreActive(a: { status: string; seq: number }, b: { status: string; seq: number }): boolean {
    const pa = STOP_PRIORITY[a.status] ?? 99;
    const pb = STOP_PRIORITY[b.status] ?? 99;
    return pa !== pb ? pa < pb : a.seq < b.seq;
  }

  private toStopEta(s: { id: string; eta: Date | null; etaLow: Date | null; etaHigh: Date | null; etaComputedAt: Date | null }): StopEta {
    const eta = s.eta as Date; // guaranteed non-null by the caller's filter
    const computedAt = s.etaComputedAt ?? eta;
    return {
      stopId: s.id,
      eta: eta.toISOString(),
      low: (s.etaLow ?? eta).toISOString(),
      high: (s.etaHigh ?? eta).toISOString(),
      etaSeconds: Math.max(0, Math.round((eta.getTime() - computedAt.getTime()) / 1000)),
      computedAt: computedAt.toISOString(),
    };
  }

  /**
   * GET /v1/orders/:id/tracking — the customer "track my truck" poll. Returns the last-known
   * of EXACTLY the one vehicle assigned to the order's active stop, scoped to the owning
   * customer (§6.2 privacy: one vehicle, never any other; cross-account/org → 404). When no
   * stop is active or no vehicle is assigned/positioned, `vehicle` is null (never a leak).
   */
  async orderTracking(principal: RequestPrincipal, orderId: string): Promise<OrderTrackingResult> {
    // Ownership/scope: getOrderForRead loads through the scoped client (404 if not visible).
    await this.orderAccess.getOrderForRead(principal, orderId);

    const stops = await scopedPrisma(this.prisma, principal).routeStop.findMany({
      where: { orderId },
      include: { route: { select: { status: true, vehicleId: true } } },
    });

    const active = selectActiveStop(stops);
    if (!active) return { orderId, stop: null, vehicle: null, channelToken: null };

    const stopShape = {
      id: active.id,
      status: active.status as unknown as string,
      kind: active.kind as unknown as string,
      eta: active.eta ? active.eta.toISOString() : null,
      etaLow: active.etaLow ? active.etaLow.toISOString() : null,
      etaHigh: active.etaHigh ? active.etaHigh.toISOString() : null,
      etaComputedAt: active.etaComputedAt ? active.etaComputedAt.toISOString() : null,
    };

    const vehicleId = active.route.vehicleId;
    if (!vehicleId) return { orderId, stop: stopShape, vehicle: null, channelToken: null };

    const vehicle =
      (await this.lastKnown.readOne(principal.orgId, vehicleId)) ??
      (await this.history.latestForVehicle(principal.orgId, vehicleId));

    // Mint the short-lived signed capability to open the live WS channel for THIS one
    // vehicle/stop (Increment 6, §6.2). The WS handshake re-checks live stop state, so the
    // token cannot be used once the stop ends regardless of its exp.
    const channelToken = this.channelTokens.mint({
      orgId: principal.orgId,
      vehicleId,
      orderId,
      stopId: active.id,
      sub: principal.userId,
    });

    return { orderId, stop: stopShape, vehicle, channelToken };
  }
}
