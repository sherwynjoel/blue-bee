import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Route, RouteStop } from '@prisma/client';
import { LOGISTICS_ERRORS } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';

type StopWithRoute = RouteStop & { route: Route };

/**
 * Parent-ownership / row-scoping gate for logistics (extends the Increment-3 pattern).
 *
 * Routes, Vehicles, Drivers, Shifts are ORG-INTERNAL (org-scoped only) — written by
 * OWNER/DISPATCHER. RouteStop additionally carries account_id/site_id so a customer's
 * scoped read is confined to their own account's stops ("track my truck"); writes are
 * org-staff only. A different-org principal sees none of this org's routes/stops (the
 * scoped client returns null → 404). Stop↔order attachment is validated separately via
 * OrderAccessService.requireOrderForWrite (org boundary on the parent order).
 */
@Injectable()
export class LogisticsAccessService {
  constructor(private readonly prisma: PrismaService) {}

  scopedFor(principal: RequestPrincipal) {
    return scopedPrisma(this.prisma, principal);
  }

  async requireRoute(principal: RequestPrincipal, routeId: string): Promise<Route> {
    const route = await this.scopedFor(principal).route.findUnique({ where: { id: routeId } });
    if (!route) {
      throw new NotFoundException({ error: LOGISTICS_ERRORS.ROUTE_NOT_FOUND, message: `Route ${routeId} not found` });
    }
    return route;
  }

  async requireStop(principal: RequestPrincipal, stopId: string): Promise<StopWithRoute> {
    const stop = await this.scopedFor(principal).routeStop.findUnique({ where: { id: stopId }, include: { route: true } });
    if (!stop) {
      throw new NotFoundException({ error: LOGISTICS_ERRORS.STOP_NOT_FOUND, message: `Stop ${stopId} not found` });
    }
    return stop as StopWithRoute;
  }

  /** Vehicle/Driver/Shift lookups are org-scoped; throw 404 if not visible to the principal. */
  async requireVehicle(principal: RequestPrincipal, vehicleId: string) {
    const v = await this.scopedFor(principal).vehicle.findUnique({ where: { id: vehicleId } });
    if (!v) throw new NotFoundException({ error: LOGISTICS_ERRORS.VEHICLE_NOT_FOUND, message: `Vehicle ${vehicleId} not found` });
    return v;
  }

  async requireDriver(principal: RequestPrincipal, driverId: string) {
    const d = await this.scopedFor(principal).driver.findUnique({ where: { id: driverId } });
    if (!d) throw new NotFoundException({ error: LOGISTICS_ERRORS.DRIVER_NOT_FOUND, message: `Driver ${driverId} not found` });
    return d;
  }

  async requireShift(principal: RequestPrincipal, shiftId: string) {
    const s = await this.scopedFor(principal).shift.findUnique({ where: { id: shiftId } });
    if (!s) throw new NotFoundException({ error: LOGISTICS_ERRORS.SHIFT_NOT_FOUND, message: `Shift ${shiftId} not found` });
    return s;
  }

  /** Guard used by reads that must never serve another org's data even on a direct id. */
  assertSameOrg(principal: RequestPrincipal, row: { orgId: string }): void {
    if (row.orgId !== principal.orgId) {
      throw new ForbiddenException({ error: LOGISTICS_ERRORS.CROSS_ORG_FORBIDDEN, message: 'Resource belongs to another organization' });
    }
  }
}
