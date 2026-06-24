import { Injectable } from '@nestjs/common';
import { type FleetLiveResult, type OrderTrackingResult } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { OrderAccessService } from '../orders/order-access.service';
import { ChannelTokenService } from '../realtime/channel-token.service';
import { GpsHistoryService } from './gps-history.service';
import { LastKnownStore } from './last-known.store';
import { selectActiveStop } from './tracking-util';

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

    const positioned: FleetLiveResult['vehicles'] = [];
    const withoutPosition: FleetLiveResult['withoutPosition'] = [];
    for (const id of ids) {
      const pos = fromRedis.get(id) ?? fromHistory.get(id);
      if (pos) positioned.push({ ...pos, label: labelOf.get(id) ?? '' });
      else withoutPosition.push({ vehicleId: id, label: labelOf.get(id) ?? '' });
    }
    return { vehicles: positioned, withoutPosition };
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
