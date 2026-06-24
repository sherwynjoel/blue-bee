import { Injectable } from '@nestjs/common';
import { RouteStatus, type ChannelTokenClaims } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { STOP_PRIORITY, WORKABLE_ROUTE } from '../tracking/tracking-util';

/**
 * Live re-authorization for the customer WS handshake (PRD §6.2). A valid signature is NOT
 * enough — the token's capability is only real while the bound stop is still active and its
 * route still points at the bound vehicle. This re-check runs on every (re)connect, so a
 * token for a completed/failed stop, a reassigned route, or a vehicle swap is rejected even
 * before its `exp`. Uses an EXPLICIT `org_id` filter (the gateway has no scoped principal) —
 * no cross-tenant read.
 */
@Injectable()
export class RealtimeAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async isStopTrackable(claims: ChannelTokenClaims): Promise<boolean> {
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: claims.stop_id, orgId: claims.org_id, orderId: claims.order_id },
      include: { route: { select: { status: true, vehicleId: true } } },
    });
    if (!stop) return false;
    if (!WORKABLE_ROUTE.has(stop.route.status as unknown as RouteStatus)) return false; // route not live
    if (!((stop.status as unknown as string) in STOP_PRIORITY)) return false; // stop terminal (completed/failed/skipped)
    if (stop.route.vehicleId !== claims.vehicle_id) return false; // route no longer points at the bound vehicle
    return true;
  }
}
